import { after } from 'next/server';
import { encounterByToken } from '@/lib/auth';
import { kickQueue } from '@/lib/pipeline/page';
import { db } from '@/lib/db';
import { json, route } from '@/lib/http';
import type { Alert, Source } from '@/lib/types';

export const maxDuration = 120;

/** Everything the patient screen needs, scoped to the token's encounter. No staff-only data. Also nudges the page queue. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const enc = await encounterByToken((await ctx.params).token);
  after(() => kickQueue(enc.id));
  const d = await db();
  const [pages, answers, alerts] = await Promise.all([
    d.query<Pick<Source, 'id' | 'label' | 'status' | 'readability' | 'identity' | 'error' | 'seq'>>(
      `select id, label, status, readability, identity, error, seq from sources where encounter_id = $1 and kind = 'page' order by seq`, [enc.id]),
    d.query<Pick<Source, 'id' | 'label' | 'kind' | 'typed_text' | 'transcript_hi' | 'supersedes_id' | 'created_at'>>(
      `select id, label, kind, typed_text, transcript_hi, supersedes_id, created_at from sources where encounter_id = $1 and kind in ('typed','clip') order by seq`, [enc.id]),
    d.query<Alert>('select * from alerts where encounter_id = $1 and resumed_at is null', [enc.id]),
  ]);
  const a = alerts[0];
  return json({
    encounter: {
      alias: enc.alias, patient_name: enc.patient_name, language: enc.language, status: enc.status, voice_consent: enc.voice_consent,
      intake_started: !!enc.intake_started_at, intake_completed: !!enc.intake_completed_at,
    },
    pages,
    answers: answers.map((x) => ({ id: x.id, label: x.label, kind: x.kind, text: x.typed_text ?? x.transcript_hi, supersedes_id: x.supersedes_id, created_at: x.created_at })),
    open_alert: a ? { id: a.id, requested_at: a.requested_at, delivered: !!a.delivered_at, acked: !!a.acked_at, acked_by: a.acked_by } : null,
    server_time: new Date().toISOString(),
  });
});
