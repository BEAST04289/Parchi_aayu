import { cookies } from 'next/headers';
import { checkPasscode, cookieOptions, encodeSession, newSession, SESSION_COOKIE } from '@/lib/auth';
import { HttpError, json, readJson, route } from '@/lib/http';

export const POST = route(async (req: Request) => {
  const body = await readJson<{ passcode?: string; name?: string; role?: string }>(req);
  if (!checkPasscode(body.passcode ?? '')) throw new HttpError(401, 'Wrong passcode.');
  const name = (body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Enter your name.');
  if (body.role !== 'nurse' && body.role !== 'doctor') throw new HttpError(400, 'Choose a role.');
  const s = newSession(name, body.role);
  (await cookies()).set(SESSION_COOKIE, encodeSession(s), cookieOptions(req));
  return json({ name: s.name, role: s.role });
});
