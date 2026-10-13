import { after } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { getSource } from '@/lib/repo';
import { processPage } from '@/lib/pipeline/page';
import { assertUuid, HttpError, json, route } from '@/lib/http';

export const maxDuration = 120;

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const id = assertUuid((await ctx.params).id, 'source');
  const s = await getSource(id);
  if (!s || s.kind !== 'page') throw new HttpError(404, 'Unknown page.');
  if (s.status !== 'failed') throw new HttpError(409, `Page is ${s.status}; only failed pages can be retried.`);
  after(() => processPage(id));
  return json({ ok: true });
});
