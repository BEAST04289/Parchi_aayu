import { requireStaff } from '@/lib/auth';
import { getEncounter } from '@/lib/repo';
import { assertUuid, json, route } from '@/lib/http';
import { kioskLink } from '@/lib/kiosk-link';

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const enc = await getEncounter(assertUuid((await ctx.params).id, 'encounter'));
  return json(await kioskLink(req, enc.token));
});
