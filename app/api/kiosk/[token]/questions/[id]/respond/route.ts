import { encounterByToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent } from '@/lib/repo';
import { assertUuid, HttpError, json, readJson, route } from '@/lib/http';

/** "पता नहीं" (unknown) or "छोड़ें" (skipped). The topic is never asked again in this encounter. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string; id: string }> }) => {
  const { token, id: rawId } = await ctx.params;
  const enc = await encounterByToken(token);
  const id = assertUuid(rawId, 'question');
  const { state } = await readJson<{ state?: string }>(req);
  if (state !== 'unknown' && state !== 'skipped') throw new HttpError(400, 'state must be unknown or skipped');
  const d = await db();
  const rows = await d.query<{ id: string }>(`update questions set state = $3 where id = $1 and encounter_id = $2 and state = 'asked' returning id`, [id, enc.id, state]);
  if (!rows[0]) throw new HttpError(404, 'Unknown or already answered question.');
  await addEvent(d, { encounter_id: enc.id, actor: 'patient', role: 'patient', type: `question_${state}`, payload: { question_id: id } });
  return json({ ok: true });
});
