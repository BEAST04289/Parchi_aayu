import { encounterByToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent } from '@/lib/repo';
import { HttpError, json, route } from '@/lib/http';

export const POST = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const enc = await encounterByToken((await ctx.params).token);
  if (enc.status === 'paused_urgent') throw new HttpError(409, 'Intake is paused until staff resume it.');
  const d = await db();
  await d.query(`update encounters set status = 'ready', intake_completed_at = coalesce(intake_completed_at, now()) where id = $1`, [enc.id]);
  await addEvent(d, { encounter_id: enc.id, actor: 'patient', role: 'patient', type: 'intake_completed', payload: {} });
  return json({ ok: true });
});
