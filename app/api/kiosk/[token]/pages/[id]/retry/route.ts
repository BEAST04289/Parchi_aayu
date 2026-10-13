import { after } from 'next/server';
import { encounterByToken } from '@/lib/auth';
import { getSource } from '@/lib/repo';
import { db } from '@/lib/db';
import { processPage } from '@/lib/pipeline/page';
import { assertUuid, HttpError, json, route } from '@/lib/http';

export const maxDuration = 120;

export const POST = route(async (_req: Request, ctx: { params: Promise<{ token: string; id: string }> }) => {
  const { token, id: rawId } = await ctx.params;
  const enc = await encounterByToken(token);
  const id = assertUuid(rawId, 'page');
  const s = await getSource(id);
  if (!s || s.encounter_id !== enc.id || s.kind !== 'page') throw new HttpError(404, 'Unknown page.');
  if (s.status !== 'failed') throw new HttpError(409, 'Only pages that failed to process can be retried.');
  // Retry uses the encounter's CURRENT mode (e.g. a page uploaded under REPLAY can be re-read in LIVE).
  await (await db()).query(`update sources set mode = (select e.mode from encounters e where e.id = sources.encounter_id) where id = $1 and status = 'failed'`, [id]);
  after(() => processPage(id));
  return json({ ok: true });
});
