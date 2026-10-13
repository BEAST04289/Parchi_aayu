import 'server-only';
import { db } from '../db';
import { getSource } from '../repo';
import { extractTranscript } from '../pipeline/extract';
import { ProviderError } from '../pipeline/errors';
import { quoteFoundIn } from '../verify/normalize';
import { candidateText } from '../data';

/**
 * Extracts atomic facts from a typed answer (or, later, a transcript). Every quote must be found in
 * the stored text; otherwise the fact is pending_check. Without ANTHROPIC_API_KEY nothing is
 * extracted and the brief shows the patient's verbatim words only. When an answer is corrected, the
 * brief ignores facts from the replaced answer (buildBrief); those rows stay untouched in history.
 */
export async function processAnswerText(sourceId: string): Promise<void> {
  const s = await getSource(sourceId);
  if (!s) return;
  const text = s.kind === 'typed' ? s.typed_text : s.transcript_hi;
  if (!text) return;
  const d = await db();
  let questionContext = 'Initial question: आज आपको क्या परेशानी है? (What problem brings you here today?)';
  if (s.question_id) {
    const [q] = await d.query<{ candidate_id: string; reason: string }>('select candidate_id, reason from questions where id = $1', [s.question_id]);
    const t = q ? candidateText(q.candidate_id) : null;
    if (t) questionContext = `${q.candidate_id}: ${t.hi} (${t.en}). ${q.reason}`;
  }
  let items;
  try {
    items = (await extractTranscript(text, questionContext)).items;
  } catch (e) {
    if (!(e instanceof ProviderError && e.kind === 'config')) console.error('[processAnswerText]', (e as Error).message);
    return; // verbatim text stays visible; nothing invented
  }
  await d.tx(async (q) => {
    for (const it of items) {
      const found = quoteFoundIn(it.quote, text);
      await q.query(
        `insert into facts (encounter_id, source_id, kind, value, value_en, quote, evidence, check_state, reasons, subject, assertion, temporality, created_by)
         values ($1,$2,$3,$4,$5,$6,'text',$7,$8,'patient',$9,$10,'system')`,
        [s.encounter_id, s.id, it.kind, it.value, it.value_en, it.quote, found ? 'source_matched' : 'pending_check',
         found ? [] : ['Quote not found in the patient’s words'], it.assertion, it.temporality],
      );
    }
  });
}
