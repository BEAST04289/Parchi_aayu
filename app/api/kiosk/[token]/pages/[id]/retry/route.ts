import { after } from 'next/server';
import { encounterByToken } from '@/lib/auth';
import { getSource } from '@/lib/repo';
import { processPage } from '@/lib/pipeline/page';
import { assertUuid, HttpError, json, route } from '@/lib/http';

export const maxDuration = 60;

export const POST = route(async (_req: Request, ctx: { params: Promise<{ token: string; id: string }> }) => {
  const { token, id: rawId } = await ctx.params;
  const enc = await encounterByToken(token);
  const id = assertUuid(rawId, 'page');
  const s = await getSource(id);
  if (!s || s.encounter_id !== enc.id || s.kind !== 'page') throw new HttpError(404, 'Unknown page.');
  if (s.status !== 'failed') throw new HttpError(409, 'Only pages that failed to process can be retried.');
  after(() => processPage(id));
  return json({ ok: true });
});
