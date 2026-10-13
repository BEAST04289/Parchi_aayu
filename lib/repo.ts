import 'server-only';
import { db, isUniqueViolation, type Queryable } from './db';
import { HttpError } from './http';
import { newKioskToken } from './auth';
import type { Alert, AppEvent, Encounter, Fact, Question, Source, StaffAlert } from './types';

/** Source columns without the (large) OCR payload. */
export const SOURCE_COLS = `id, encounter_id, kind, seq, label, blob_id, mime, sha256, status, error, readability, identity,
  mode, model, timings, null::jsonb as ocr, doc_type, clinic, doc_date, name_on_doc, age_on_doc, id_on_doc, width, height,
  question_id, typed_text, transcript_hi, transcript_en, translation_by, duration_ms, supersedes_id, created_at`;

export async function listEncounters(): Promise<(Encounter & { open_alert: boolean })[]> {
  const d = await db();
  return d.query(`select e.*, exists(select 1 from alerts a where a.encounter_id = e.id and a.resumed_at is null) as open_alert
                  from encounters e order by e.created_at desc limit 50`);
}

export async function createEncounter(input: { patient_name: string; patient_age: number | null; patient_ref: string | null }): Promise<Encounter> {
  const d = await db();
  const [{ n }] = await d.query<{ n: number }>('select count(*)::int as n from encounters');
  const rows = await d.query<Encounter>(
    `insert into encounters (token, alias, patient_name, patient_age, patient_ref) values ($1,$2,$3,$4,$5) returning *`,
    [newKioskToken(), `D${n + 1}`, input.patient_name, input.patient_age, input.patient_ref],
  );
  return rows[0];
}

export async function getEncounter(id: string): Promise<Encounter> {
  const d = await db();
  const rows = await d.query<Encounter>('select * from encounters where id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Unknown encounter.');
  return rows[0];
}

export interface Bundle { encounter: Encounter; sources: Source[]; facts: Fact[]; questions: Question[]; events: AppEvent[]; alerts: Alert[] }

export async function loadBundle(encounterId: string): Promise<Bundle> {
  const d = await db();
  const encounter = await getEncounter(encounterId);
  const [sources, facts, questions, events, alerts] = await Promise.all([
    d.query<Source>(`select ${SOURCE_COLS} from sources where encounter_id = $1 order by seq`, [encounterId]),
    d.query<Fact>('select * from facts where encounter_id = $1 and superseded_by is null order by created_at, id', [encounterId]),
    d.query<Question>('select * from questions where encounter_id = $1 order by created_at', [encounterId]),
    d.query<AppEvent>('select * from events where encounter_id = $1 order by created_at, id', [encounterId]),
    d.query<Alert>('select * from alerts where encounter_id = $1 order by requested_at', [encounterId]),
  ]);
  return { encounter, sources, facts, questions, events, alerts };
}

export async function addEvent(q: Queryable, e: Omit<AppEvent, 'id' | 'created_at'>): Promise<void> {
  await q.query('insert into events (encounter_id, actor, role, type, payload) values ($1,$2,$3,$4,$5)', [
    e.encounter_id, e.actor, e.role, e.type, JSON.stringify(e.payload ?? {}),
  ]);
}

/** Inserts a source with the next per-encounter sequence number; retries if two inserts race. */
export async function insertSource(
  q: Queryable,
  s: { encounter_id: string; kind: Source['kind']; label_prefix: string; blob_id?: string | null; mime?: string | null; sha256?: string | null;
       mode: Source['mode']; status?: Source['status']; typed_text?: string | null; question_id?: string | null; supersedes_id?: string | null; duration_ms?: number | null },
): Promise<Source> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [{ next }] = await q.query<{ next: number }>('select coalesce(max(seq), 0)::int + 1 as next from sources where encounter_id = $1', [s.encounter_id]);
    const countKind = await q.query<{ n: number }>('select count(*)::int as n from sources where encounter_id = $1 and kind = $2', [s.encounter_id, s.kind]);
    const label = `${s.label_prefix}${countKind[0].n + 1}`;
    try {
      const rows = await q.query<Source>(
        `insert into sources (encounter_id, kind, seq, label, blob_id, mime, sha256, mode, status, typed_text, question_id, supersedes_id, duration_ms)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning ${SOURCE_COLS}`,
        [s.encounter_id, s.kind, next, label, s.blob_id ?? null, s.mime ?? null, s.sha256 ?? null, s.mode, s.status ?? 'uploaded',
         s.typed_text ?? null, s.question_id ?? null, s.supersedes_id ?? null, s.duration_ms ?? null],
      );
      return rows[0];
    } catch (e) {
      // seq race -> retry; sha256 duplicate is handled by the caller before insert.
      if (isUniqueViolation(e) && attempt < 3 && String((e as { constraint?: string; message?: string }).message ?? '').includes('seq')) continue;
      throw e;
    }
  }
  throw new HttpError(409, 'Could not store the source. Please try again.');
}

export async function putBlob(q: Queryable, encounterId: string, mime: string, bytes: Uint8Array): Promise<string> {
  const rows = await q.query<{ id: string }>('insert into blobs (encounter_id, mime, size_bytes, data) values ($1,$2,$3,$4) returning id', [
    encounterId, mime, bytes.byteLength, Buffer.from(bytes),
  ]);
  return rows[0].id;
}

export async function getBlob(id: string): Promise<{ mime: string; data: Buffer; encounter_id: string } | null> {
  const d = await db();
  const rows = await d.query<{ mime: string; data: Uint8Array; encounter_id: string }>('select mime, data, encounter_id from blobs where id = $1', [id]);
  if (!rows[0]) return null;
  return { mime: rows[0].mime, encounter_id: rows[0].encounter_id, data: Buffer.from(rows[0].data) };
}

export async function getSource(id: string, withOcr = false): Promise<Source | null> {
  const d = await db();
  const cols = withOcr ? '*' : SOURCE_COLS;
  const rows = await d.query<Source>(`select ${cols} from sources where id = $1`, [id]);
  return rows[0] ?? null;
}

/** Open (not resumed) alerts across ALL encounters, for every staff screen. */
export async function openAlerts(): Promise<StaffAlert[]> {
  const d = await db();
  return d.query<StaffAlert>(
    `select a.*, e.alias, e.patient_name from alerts a join encounters e on e.id = a.encounter_id
     where a.resumed_at is null order by a.requested_at`,
  );
}

/**
 * Idempotent: at most one open alert per encounter (enforced by a partial unique index).
 * Also pauses intake.
 */
export async function raiseAlert(encounterId: string, trigger: Alert['trigger'], quote: string | null, sourceId: string | null): Promise<Alert> {
  const d = await db();
  return d.tx(async (q) => {
    const inserted = await q.query<Alert>(
      `insert into alerts (encounter_id, trigger, quote, source_id) values ($1,$2,$3,$4)
       on conflict (encounter_id) where resumed_at is null do nothing returning *`,
      [encounterId, trigger, quote, sourceId],
    );
    await q.query(`update encounters set status = 'paused_urgent' where id = $1`, [encounterId]);
    if (inserted[0]) {
      await addEvent(q, { encounter_id: encounterId, actor: 'patient', role: 'patient', type: 'alert_requested', payload: { alert_id: inserted[0].id, trigger, quote } });
      return inserted[0];
    }
    const existing = await q.query<Alert>('select * from alerts where encounter_id = $1 and resumed_at is null', [encounterId]);
    return existing[0];
  });
}
