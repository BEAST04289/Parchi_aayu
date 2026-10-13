import { encounterByToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { loadBundle } from '@/lib/repo';
import { buildBrief } from '@/lib/brief/build';
import { eligibleQuestions, MAX_QUESTIONS, questionView } from '@/lib/questions/eligible';
import { json, route } from '@/lib/http';
import type { Question } from '@/lib/types';

/**
 * Next follow-up question for this encounter (deterministic; see lib/questions/eligible.ts).
 * Returns an already-asked but unanswered question first, so a refresh resumes it.
 * { done: true, waiting } when nothing is eligible; waiting = pages still being read.
 */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const enc = await encounterByToken((await ctx.params).token);
  const d = await db();
  const bundle = await loadBundle(enc.id);
  const pending = bundle.questions.find((q) => q.state === 'asked' && !q.answer_source_id);
  const brief = buildBrief(bundle);
  const waiting = brief.coverage.processing > 0 && bundle.questions.length < MAX_QUESTIONS;
  const view = (q: Pick<Question, 'id' | 'candidate_id' | 'reason'>, details: string | null) => ({ id: q.id, candidate_id: q.candidate_id, reason: q.reason, details, ...questionView(q.candidate_id) });
  if (pending) return json({ question: view(pending, null), done: false, waiting });
  const next = eligibleQuestions(bundle, brief)[0];
  if (!next) return json({ done: true, waiting });
  const rows = await d.query<Question>(
    `insert into questions (encounter_id, candidate_id, reason, fact_ids, picked_by) values ($1,$2,$3,$4,'priority')
     on conflict (encounter_id, candidate_id) do nothing returning *`,
    [enc.id, next.candidate, next.reason, next.fact_ids],
  );
  if (!rows[0]) return json({ done: true, waiting });
  return json({ question: view(rows[0], next.details), done: false, waiting });
});
