import { candidateText, QUESTIONS } from '../data';
import type { Bundle } from '../repo';
import type { Brief, CandidateId } from '../types';

export interface Eligible { candidate: CandidateId; reason: string; fact_ids: string[]; details: string | null }

const TIME_CUE = /(दिन|हफ्त|हफ़्त|महीन|साल|घंट|कल से|परसों|सुबह से|day|week|month|year|hour|since)/i;
const UNNAMED_TABLET = /(सफेद गोली|सफ़ेद गोली|white (tablet|pill)|नाम याद नहीं|name.*(not|don't) remember)/i;
export const MAX_QUESTIONS = 3;

/**
 * Deterministic, gap-driven follow-up selection (no model, no diagnosis). Candidates come only from
 * missing information or documented contradictions, in a fixed priority. Topics already asked
 * (answered, unknown or skipped) are never asked again; at most three questions per encounter.
 */
export function eligibleQuestions(b: Bundle, brief: Brief): Eligible[] {
  const asked = new Set(b.questions.map((q) => q.candidate_id));
  if (asked.size >= MAX_QUESTIONS) return [];
  const answers = brief.reason.filter((l) => l.check === 'verbatim').map((l) => l.text_hi ?? l.text);
  const allText = answers.join(' ');
  const out: Eligible[] = [];

  const hasOnset = b.facts.some((f) => f.kind === 'onset' || f.kind === 'duration') || TIME_CUE.test(allText);
  if (answers.length > 0 && !hasOnset) out.push({ candidate: 'onset_missing', reason: 'A complaint was recorded without when it started.', fact_ids: [], details: null });

  const changed = brief.medicines.find((r) => r.flags.some((f) => f.rule_id.startsWith('med.strength_changed')) && r.patient_reports.length === 0);
  if (changed) {
    const flag = changed.flags.find((f) => f.rule_id.startsWith('med.strength_changed'))!;
    out.push({ candidate: 'medicine_old_or_new', reason: `Two papers show different strengths of ${changed.name}.`, fact_ids: flag.fact_ids, details: `पर्चों में / On the papers: ${changed.name} ${flag.detail}` });
  }

  if (UNNAMED_TABLET.test(allText)) out.push({ candidate: 'medicine_unknown', reason: 'A tablet was described without a name.', fact_ids: [], details: null });

  if (brief.coverage.withheld > 0) out.push({ candidate: 'page_identity', reason: 'A page shows a different name.', fact_ids: [], details: null });

  // The optional concern question waits until papers are read, so document-based questions get their slot.
  if (answers.length > 0 && brief.coverage.processing === 0) out.push({ candidate: 'patient_concern', reason: 'Optional: anything the patient wants the doctor to know.', fact_ids: [], details: null });

  return out.filter((e) => !asked.has(e.candidate)).slice(0, MAX_QUESTIONS - asked.size);
}

export function questionView(candidate: string) {
  const c = QUESTIONS.candidates.find((x) => x.id === candidate);
  const t = candidateText(candidate);
  return { hi: t?.hi ?? candidate, en: t?.en ?? candidate, why_en: c?.why_en ?? null };
}
