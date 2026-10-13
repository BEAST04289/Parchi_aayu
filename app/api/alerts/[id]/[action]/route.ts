import { requireStaff, staffActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent } from '@/lib/repo';
import { assertUuid, HttpError, json, route } from '@/lib/http';
import type { Alert } from '@/lib/types';

/**
 * delivered: a staff client received the alert (set once, automatically by the staff screen).
 * ack: a staff member clicked Acknowledge. resume: a staff member explicitly resumes intake.
 * Each step is stored with its actor; acknowledgement is not clinical clearance.
 */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string; action: string }> }) => {
  const s = await requireStaff();
  const { id: rawId, action } = await ctx.params;
  const id = assertUuid(rawId, 'alert');
  const d = await db();
  const actor = staffActor(s);
  const result = await d.tx(async (q) => {
    const [a] = await q.query<Alert>('select * from alerts where id = $1 for update', [id]);
    if (!a) throw new HttpError(404, 'Unknown alert.');
    if (action === 'delivered') {
      if (a.delivered_at) return a;
      const [u] = await q.query<Alert>('update alerts set delivered_at = now() where id = $1 returning *', [id]);
      await addEvent(q, { encounter_id: a.encounter_id, actor, role: s.role, type: 'alert_delivered', payload: { alert_id: id } });
      return u;
    }
    if (action === 'ack') {
      if (a.acked_at) return a;
      const [u] = await q.query<Alert>('update alerts set acked_at = now(), acked_by = $2, delivered_at = coalesce(delivered_at, now()) where id = $1 returning *', [id, actor]);
      await addEvent(q, { encounter_id: a.encounter_id, actor, role: s.role, type: 'alert_ack', payload: { alert_id: id } });
      return u;
    }
    if (action === 'resume') {
      if (!a.acked_at) throw new HttpError(409, 'Acknowledge the alert before resuming intake.');
      if (a.resumed_at) return a;
      const [u] = await q.query<Alert>('update alerts set resumed_at = now(), resumed_by = $2 where id = $1 returning *', [id, actor]);
      await q.query(`update encounters set status = 'intake' where id = $1 and status = 'paused_urgent'`, [a.encounter_id]);
      await addEvent(q, { encounter_id: a.encounter_id, actor, role: s.role, type: 'intake_resumed', payload: { alert_id: id } });
      return u;
    }
    throw new HttpError(404, 'Unknown action.');
  });
  return json({ alert: result });
});
