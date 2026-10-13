import { requireStaff, staffActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent, getEncounter } from '@/lib/repo';
import { assertUuid, HttpError, json, readJson, route } from '@/lib/http';
import { SECTION_KEYS, type SectionKey } from '@/lib/types';

/**
 * Records the section hashes the doctor actually had on screen (sent by the client), never the
 * server's latest. Newer, unseen content therefore shows as "changed since your review" at once.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireStaff(['doctor']);
  const id = assertUuid((await ctx.params).id, 'encounter');
  await getEncounter(id);
  const body = await readJson<{ section_hashes?: Record<string, unknown>; revision?: string }>(req);
  const given = body.section_hashes ?? {};
  const section_hashes: Partial<Record<SectionKey, string>> = {};
  for (const [k, v] of Object.entries(given)) {
    if (!SECTION_KEYS.includes(k as SectionKey) || typeof v !== 'string' || !/^[0-9a-f]{40}$/.test(v)) throw new HttpError(400, `Invalid section hash for ${k}.`);
    section_hashes[k as SectionKey] = v;
  }
  if (Object.keys(section_hashes).length === 0) throw new HttpError(400, 'No sections to review.');
  await addEvent(await db(), { encounter_id: id, actor: staffActor(s), role: 'doctor', type: 'doctor_review', payload: { section_hashes, displayed_revision: body.revision ?? null } });
  return json({ ok: true });
});
