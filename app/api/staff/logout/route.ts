import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';
import { json, route } from '@/lib/http';

export const POST = route(async () => {
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
});
