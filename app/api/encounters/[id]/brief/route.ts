import { requireStaff } from '@/lib/auth';
import { loadBundle } from '@/lib/repo';
import { buildBrief } from '@/lib/brief/build';
import { assertUuid, json, route } from '@/lib/http';

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const id = assertUuid((await ctx.params).id, 'encounter');
  const brief = buildBrief(await loadBundle(id));
  const { token: _t, ...encounter } = brief.encounter;
  return json({ ...brief, encounter });
});
