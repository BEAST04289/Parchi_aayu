import { after } from 'next/server';
import { encounterByToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent, insertSource, putBlob, raiseAlert } from '@/lib/repo';
import { DRUGS, matchUrgent } from '@/lib/data';
import { processAnswerText } from '@/lib/speech/answer';
import { transcribeLocal } from '@/lib/speech/asr';
import { ProviderError } from '@/lib/pipeline/errors';
import { HttpError, json, readJson, route } from '@/lib/http';
import type { Source } from '@/lib/types';

export const maxDuration = 120;
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac)/;
const MAX_AUDIO = 4_000_000;

/**
 * Patient answer: typed (JSON {text, question_id?, supersedes_id?}) or voice (multipart: audio,
 * question_id?, supersedes_id?, duration_ms?). Everything is stored first; the urgent-word check is
 * deterministic and runs before any model call. Voice: the original clip is always kept, even when
 * transcription fails.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const enc = await encounterByToken((await ctx.params).token);
  const d = await db();
  const isMultipart = (req.headers.get('content-type') ?? '').startsWith('multipart/');
  let text = '';
  let questionIdRaw: string | null = null;
  let supersedesRaw: string | null = null;
  let audio: File | null = null;
  let durationMs: number | null = null;
  if (isMultipart) {
    const form = await req.formData().catch(() => { throw new HttpError(400, 'Expected an audio upload.'); });
    const f = form.get('audio');
    if (!(f instanceof File) || f.size === 0) throw new HttpError(400, 'No audio received. Please try again or type your answer.');
    if (!AUDIO_TYPES.test(f.type)) throw new HttpError(415, `Unsupported audio type ${f.type || '(none)'}.`);
    if (f.size > MAX_AUDIO) throw new HttpError(413, 'Recording too long. Please keep it under 25 seconds.');
    audio = f;
    questionIdRaw = (form.get('question_id') as string) || null;
    supersedesRaw = (form.get('supersedes_id') as string) || null;
    durationMs = Number(form.get('duration_ms')) || null;
  } else {
    const b = await readJson<{ text?: string; question_id?: string | null; supersedes_id?: string | null }>(req);
    text = (b.text ?? '').trim();
    if (!text) throw new HttpError(400, 'Please type something first.');
    if (text.length > 2000) throw new HttpError(400, 'That is too long (2000 characters max).');
    questionIdRaw = b.question_id ?? null;
    supersedesRaw = b.supersedes_id ?? null;
  }

  let supersedes: string | null = null;
  if (supersedesRaw) {
    const prev = await d.query<Pick<Source, 'id'>>(`select id from sources where id = $1 and encounter_id = $2 and kind in ('typed','clip')`, [supersedesRaw, enc.id]);
    if (!prev[0]) throw new HttpError(404, 'Unknown answer to correct.');
    supersedes = prev[0].id;
  }
  let questionId: string | null = null;
  if (questionIdRaw) {
    const qrow = await d.query<{ id: string }>('select id from questions where id = $1 and encounter_id = $2', [questionIdRaw, enc.id]);
    if (!qrow[0]) throw new HttpError(404, 'Unknown question.');
    questionId = qrow[0].id;
  }

  let src: Source;
  let asrError: string | null = null;
  if (audio) {
    const bytes = Buffer.from(await audio.arrayBuffer());
    const blobId = await putBlob(d, enc.id, audio.type.split(';')[0], bytes);
    src = await insertSource(d, { encounter_id: enc.id, kind: 'clip', label_prefix: 'q', blob_id: blobId, mime: audio.type, mode: 'live', status: 'processing', question_id: questionId, supersedes_id: supersedes, duration_ms: durationMs });
    // Vocabulary hint: medicine names already read from this patient's documents, then the drug list.
    const docNames = (await d.query<{ value: string }>(`select distinct value from facts where encounter_id = $1 and kind = 'med_name' and superseded_by is null`, [enc.id])).map((r) => r.value);
    try {
      const r = await transcribeLocal(bytes, [...docNames, ...DRUGS.map((x) => x.name)]);
      text = r.hi.text.trim();
      await d.query(
        `update sources set status = 'done', transcript_hi = $2, transcript_en = $3, translation_by = $4, provider_info = $5, timings = $6, error = $7 where id = $1`,
        [src.id, text || null, r.en?.text?.trim() || null, r.en?.text ? 'whisper' : null, JSON.stringify(r.steps),
         JSON.stringify({ asr_ms: r.hi.ms, translate_ms: r.en?.ms ?? 0, audio_s: r.hi.duration_s, language_probability: r.hi.language_probability }),
         text ? null : 'No speech was recognised in this recording.'],
      );
      if (!text) asrError = 'No speech was recognised. Please speak again or type your answer.';
    } catch (e) {
      asrError = e instanceof ProviderError ? `${e.message} Your recording is saved; please type your answer or try again.` : 'Speech recognition failed. Your recording is saved; please type your answer.';
      await d.query(`update sources set status = 'failed', error = $2 where id = $1`, [src.id, asrError]);
    }
    await addEvent(d, { encounter_id: enc.id, actor: 'patient', role: 'patient', type: supersedes ? 'answer_rerecorded' : 'answer_recorded', payload: { source_id: src.id, supersedes_id: supersedes, transcribed: !!text } });
  } else {
    src = await insertSource(d, { encounter_id: enc.id, kind: 'typed', label_prefix: 'a', mode: 'manual', status: 'done', typed_text: text, question_id: questionId, supersedes_id: supersedes });
    await addEvent(d, { encounter_id: enc.id, actor: 'patient', role: 'patient', type: supersedes ? 'answer_corrected' : 'answer_typed', payload: { source_id: src.id, supersedes_id: supersedes } });
  }
  if (questionId && text) await d.query(`update questions set state = 'answered', answer_source_id = $2 where id = $1`, [questionId, src.id]);

  const urgent = matchUrgent(text);
  let paused = false;
  if (urgent) {
    await raiseAlert(enc.id, 'words', urgent.phrase, src.id);
    paused = true;
  }
  if (text) after(() => processAnswerText(src.id));
  return json({ source: { id: src.id, label: src.label, kind: src.kind, text: text || null }, paused, error: asrError }, 201);
});
