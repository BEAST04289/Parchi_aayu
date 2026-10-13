import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import { HttpError } from './http';
import type { Encounter, StaffRole } from './types';

/**
 * Staff session: an HMAC-SHA256 signed cookie {name, role, exp}. A tampered, unsigned or expired
 * cookie is rejected. Demo roles: anyone with STAFF_PASSCODE may pick nurse or doctor at login.
 * That is a demo convenience, not production access control.
 */
export const SESSION_COOKIE = 'parchi_staff';
const SESSION_HOURS = 12;

export interface StaffSession { name: string; role: StaffRole; exp: number }

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new HttpError(503, 'Server is missing SESSION_SECRET (32+ characters). Staff login is disabled.');
  return Buffer.from(s, 'utf8');
}

function sign(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

export function encodeSession(s: StaffSession): string {
  const payload = Buffer.from(JSON.stringify(s), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(raw: string | undefined): StaffSession | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1), 'utf8');
  const expected = Buffer.from(sign(payload), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StaffSession;
    if (typeof s.exp !== 'number' || s.exp < Date.now()) return null;
    if (s.role !== 'nurse' && s.role !== 'doctor') return null;
    if (typeof s.name !== 'string' || !s.name.trim()) return null;
    return s;
  } catch {
    return null;
  }
}

export function newSession(name: string, role: StaffRole): StaffSession {
  return { name: name.trim().slice(0, 60), role, exp: Date.now() + SESSION_HOURS * 3600_000 };
}

export function checkPasscode(given: string): boolean {
  const expected = process.env.STAFF_PASSCODE;
  if (!expected) throw new HttpError(503, 'Server is missing STAFF_PASSCODE. Staff login is disabled.');
  const a = Buffer.from(given ?? '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieOptions(req: Request) {
  const secure = !!process.env.VERCEL || new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: SESSION_HOURS * 3600 };
}

/** Every staff route calls this first. */
export async function requireStaff(roles?: StaffRole[]): Promise<StaffSession> {
  const store = await cookies();
  const s = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!s) throw new HttpError(401, 'Staff sign-in required.');
  if (roles && !roles.includes(s.role)) throw new HttpError(403, `This action needs the ${roles.join(' or ')} role.`);
  return s;
}

export function staffActor(s: StaffSession): string {
  return `${s.role === 'doctor' ? 'Dr ' : ''}${s.name}`.replace(/^Dr Dr /, 'Dr ');
}

/** Kiosk access: the unguessable token in the URL selects exactly one encounter. */
export async function encounterByToken(token: string): Promise<Encounter> {
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(token)) throw new HttpError(404, 'This link is not valid.');
  const d = await db();
  const rows = await d.query<Encounter>('select * from encounters where token = $1', [token]);
  if (!rows[0]) throw new HttpError(404, 'This link is not valid.');
  return rows[0];
}

export function newKioskToken(): string {
  return randomBytes(18).toString('base64url'); // 24 chars, 144 bits
}
