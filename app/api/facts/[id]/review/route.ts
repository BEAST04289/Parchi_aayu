import { requireStaff, staffActor } from '@/lib/auth';
import { db, isUniqueViolation, type Queryable } from '@/lib/db';
import { addEvent } from '@/lib/repo';
import { assertUuid, HttpError, json, readJson, route } from '@/lib/http';
import type { CheckState, Fact } from '@/lib/types';

const NUMERIC_KINDS = new Set(['med_strength', 'lab_value']);

/**
 * Source check by a nurse (or doctor): confirm the reading, correct it, or mark it unreadable.
 * Appends a new fact revision; the old one stays in history. Compare-and-swap: the request names the
 * revision it saw; if that revision already has a successor (or a concurrent request wins the unique
 * index on supersedes_id), this request gets 409 and nothing is written.
 * Checking a source is not clinical approval.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireStaff(['nurse', 'doctor']);
  const id = assertUuid((await ctx.params).id, 'fact');
  const body = await readJson<{ action?: string; value?: string }>(req);
  const action = body.action;
  if (action !== 'confirm' && action !== 'correct' && action !== 'unreadable') throw new HttpError(400, 'Action must be confirm, correct or unreadable.');
  const newValue = action === 'correct' ? (body.value ?? '').trim() : null;
  if (action === 'correct' && !newValue) throw new HttpError(400, 'A correction needs an explicit value.');
  const actor = staffActor(s);
  const d = await db();

  const conflict = async (q: Queryable, old: Fact) => {
    const [succ] = old.superseded_by ? await q.query<Fact>('select created_by, created_at from facts where id = $1', [old.superseded_by]) : [];
    return new HttpError(409, succ ? `Already updated by ${succ.created_by} at ${succ.created_at}. Reload to see the current reading.` : 'This reading was changed by someone else. Reload.');
  };

  try {
    const created = await d.tx(async (q) => {
      const [old] = await q.query<Fact>('select * from facts where id = $1', [id]);
      if (!old) throw new HttpError(404, 'Unknown fact.');
      if (old.superseded_by) throw await conflict(q, old);
      if (action === 'correct' && NUMERIC_KINDS.has(old.kind) && !/\d/.test(newValue!)) throw new HttpError(400, 'This field needs a number.');
      const state: CheckState = action === 'confirm' ? 'nurse_confirmed' : action === 'correct' ? 'nurse_corrected' : 'unreadable';
      const [nf] = await q.query<Fact>(
        `insert into facts (encounter_id, source_id, group_key, kind, value, value_en, quote, anchor, evidence, check_state, reasons, subject, assertion, temporality, supersedes_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
        [old.encounter_id, old.source_id, old.group_key, old.kind, newValue ?? old.value, old.value_en, old.quote,
         old.anchor ? JSON.stringify(old.anchor) : null, old.evidence, state, [], old.subject, old.assertion, old.temporality, old.id, actor],
      );
      const upd = await q.query<{ id: string }>('update facts set superseded_by = $2 where id = $1 and superseded_by is null returning id', [old.id, nf.id]);
      if (upd.length !== 1) throw await conflict(q, old);
      await addEvent(q, {
        encounter_id: old.encounter_id, actor, role: s.role, type: `nurse_${action}`,
        payload: { fact_id: old.id, new_fact_id: nf.id, kind: old.kind, old_value: old.value, new_value: nf.value, old_check: old.check_state },
      });
      return nf;
    });
    return json({ fact: created });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const [old] = await d.query<Fact>('select * from facts where id = $1', [id]);
      throw await conflict(d, old);
    }
    throw e;
  }
});
