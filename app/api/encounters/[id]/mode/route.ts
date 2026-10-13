import { requireStaff, staffActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent, getEncounter } from '@/lib/repo';
import { assertUuid, HttpError, json, readJson, route } from '@/lib/http';

/** LIVE or REPLAY for new uploads in this encounter. Stored on every source it affects. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireStaff();
  const id = assertUuid((await ctx.params).id, 'encounter');
  const { mode } = await readJson<{ mode?: string }>(req);
  if (mode !== 'live' && mode !== 'replay') throw new HttpError(400, 'Mode must be live or replay.');
  await getEncounter(id);
  const d = await db();
  await d.query('update encounters set mode = $2 where id = $1', [id, mode]);
  await addEvent(d, { encounter_id: id, actor: staffActor(s), role: s.role, type: 'mode_changed', payload: { mode } });
  return json({ mode });
});
