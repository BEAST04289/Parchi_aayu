import { cookies } from 'next/headers';
import { DEMO_COOKIE, demoCookieOptions, encodeDemo } from '@/lib/auth';
import { db } from '@/lib/db';
import { HttpError, json, route } from '@/lib/http';

/**
 * Public, no-login entry for judges: issues a read-only demo cookie scoped to the one synthetic demo
 * encounter (alias from DEMO_ENCOUNTER_ALIAS, default D16). It grants no staff access and no writes.
 */
export const POST = route(async (req: Request) => {
  const alias = process.env.DEMO_ENCOUNTER_ALIAS || 'D16';
  const rows = await (await db()).query<{ id: string }>('select id from encounters where alias = $1', [alias]);
  if (!rows[0]) throw new HttpError(404, `The demo encounter (${alias}) is not on this server.`);
  (await cookies()).set(DEMO_COOKIE, encodeDemo(rows[0].id), demoCookieOptions(req));
  return json({ encounter_id: rows[0].id, alias });
});
