import { after } from 'next/server';
import { encounterByToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent, insertSource, raiseAlert } from '@/lib/repo';
import { matchUrgent } from '@/lib/data';
import { processAnswerText } from '@/lib/speech/answer';
import { HttpError, json, readJson, route } from '@/lib/http';
import type { Source } from '@/lib/types';

export const maxDuration = 120;

/**
 * Typed answer (JSON {text, question_id?, supersedes_id?}). Stored verbatim first; the urgent-word
 * check is deterministic and runs before any AI call. Voice upload (multipart) belongs to prompt B1.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const enc = await encounterByToken((await ctx.params).token);
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/')) {
    throw new HttpError(501, 'Voice answers are not implemented yet (prompt B1). Please type your answer.');
  }
  const b = await readJson<{ text?: string; question_id?: string | null; supersedes_id?: string | null }>(req);
  const text = (b.text ?? '').trim();
  if (!text) throw new HttpError(400, 'Please type something first.');
  if (text.length > 2000) throw new HttpError(400, 'That is too long (2000 characters max).');
  const d = await db();

  let supersedes: string | null = null;
  if (b.supersedes_id) {
    const prev = await d.query<Pick<Source, 'id'>>(`select id from sources where id = $1 and encounter_id = $2 and kind in ('typed','clip')`, [b.supersedes_id, enc.id]);
    if (!prev[0]) throw new HttpError(404, 'Unknown answer to correct.');
    supersedes = prev[0].id;
  }
  let questionId: string | null = null;
  if (b.question_id) {
    const qrow = await d.query<{ id: string }>('select id from questions where id = $1 and encounter_id = $2', [b.question_id, enc.id]);
    if (!qrow[0]) throw new HttpError(404, 'Unknown question.');
    questionId = qrow[0].id;
  }

  const src = await insertSource(d, { encounter_id: enc.id, kind: 'typed', label_prefix: 'a', mode: 'manual', status: 'done', typed_text: text, question_id: questionId, supersedes_id: supersedes });
  await addEvent(d, { encounter_id: enc.id, actor: 'patient', role: 'patient', type: supersedes ? 'answer_corrected' : 'answer_typed', payload: { source_id: src.id, supersedes_id: supersedes } });
  if (questionId) await d.query(`update questions set state = 'answered', answer_source_id = $2 where id = $1`, [questionId, src.id]);

  const urgent = matchUrgent(text);
  let paused = false;
  if (urgent) {
    await raiseAlert(enc.id, 'words', urgent.phrase, src.id);
    paused = true;
  }
  after(() => processAnswerText(src.id));
  return json({ source: { id: src.id, label: src.label, text }, paused }, 201);
});
