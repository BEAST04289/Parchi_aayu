import { requireStaff, staffActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent, createEncounter, listEncounters } from '@/lib/repo';
import { HttpError, json, readJson, route } from '@/lib/http';
import { kioskLink } from '@/lib/kiosk-link';

export const GET = route(async () => {
  await requireStaff();
  const rows = await listEncounters();
  return json({ encounters: rows.map(({ token: _t, ...e }) => e) });
});

export const POST = route(async (req: Request) => {
  const s = await requireStaff();
  const b = await readJson<{ patient_name?: string; patient_age?: number | string | null; patient_ref?: string | null }>(req);
  const name = (b.patient_name ?? '').trim();
  if (!name || name.length > 60) throw new HttpError(400, 'Enter the patient name (up to 60 characters).');
  const ageRaw = b.patient_age === '' || b.patient_age === null || b.patient_age === undefined ? null : Number(b.patient_age);
  if (ageRaw !== null && (!Number.isInteger(ageRaw) || ageRaw < 0 || ageRaw > 120)) throw new HttpError(400, 'Age must be a whole number from 0 to 120.');
  const ref = (b.patient_ref ?? '').trim().slice(0, 30) || null;
  const enc = await createEncounter({ patient_name: name, patient_age: ageRaw, patient_ref: ref });
  await addEvent(await db(), { encounter_id: enc.id, actor: staffActor(s), role: s.role, type: 'encounter_created', payload: {} });
  const link = await kioskLink(req, enc.token);
  const { token: _t, ...rest } = enc;
  return json({ encounter: rest, ...link }, 201);
});
