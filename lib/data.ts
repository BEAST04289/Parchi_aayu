import drugsJson from '@/data/drugs.json';
import allergyJson from '@/data/allergy-classes.json';
import urgentJson from '@/data/urgent-triggers.json';
import questionsJson from '@/data/questions.json';
import type { DrugEntry } from './verify/page';
import { normTokens, findRun } from './verify/normalize';

export const DRUGS: DrugEntry[] = drugsJson.drugs as DrugEntry[];
export const ALLERGY_CLASSES = allergyJson.classes as { id: string; label_en: string; label_hi: string; allergy_terms: string[]; drug_class: string }[];
export const QUESTIONS = questionsJson;
export const URGENT_VERSION = urgentJson.version;

const URGENT_PHRASES = urgentJson.groups.flatMap((g) => g.phrases.map((p) => ({ group: g.id, label: g.label_en, phrase: p, tokens: normTokens(p) })));

/**
 * Deterministic urgent-word check (no AI). A match pauses intake and alerts staff. A false positive
 * is the safe direction; absence of a match never means "safe".
 */
export function matchUrgent(text: string | null | undefined): { group: string; label: string; phrase: string } | null {
  if (!text) return null;
  const toks = normTokens(text);
  for (const p of URGENT_PHRASES) if (p.tokens.length && findRun(toks, p.tokens) >= 0) return { group: p.group, label: p.label, phrase: p.phrase };
  return null;
}

export function candidateText(id: string): { hi: string; en: string } | null {
  const c = questionsJson.candidates.find((x) => x.id === id);
  return c ? { hi: c.hi, en: c.en } : null;
}
