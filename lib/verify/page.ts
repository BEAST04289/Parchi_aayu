import { findRun, normTokens } from './normalize';
import type { CheckState, OcrPage } from '../types';

export type PageItemKind =
  | 'med_name' | 'med_strength' | 'med_frequency' | 'med_form' | 'med_duration'
  | 'allergy' | 'allergy_reaction' | 'lab_name' | 'lab_value' | 'lab_unit' | 'lab_range';
export const PAGE_ITEM_KINDS: PageItemKind[] = ['med_name', 'med_strength', 'med_frequency', 'med_form', 'med_duration', 'allergy', 'allergy_reaction', 'lab_name', 'lab_value', 'lab_unit', 'lab_range'];

export interface ExtractedItem {
  group: number; kind: string; value: string; ocr_quote: string | null; illegible: boolean;
  subject: 'patient' | 'other_person' | 'unknown'; assertion: 'present' | 'denied' | 'uncertain';
  temporality: 'current' | 'historical' | 'unknown';
}

export interface DrugEntry { name: string; class: string; unit: string; strengths: number[]; aliases: string[] }

export interface VerifiedItem {
  item: ExtractedItem & { kind: PageItemKind };
  check_state: CheckState;
  evidence: 'box' | 'page';
  boxes: [number, number, number, number][];
  /** 'word': the box covers only the value's own OCR words; 'line': it covers the cited text/line. */
  precision: 'word' | 'line' | null;
  reasons: string[];
}

export interface VerifyResult { kept: VerifiedItem[]; held_back: { item: ExtractedItem; reason: string }[] }

/** Default only; callers pass a provider-specific (provisional, uncalibrated) threshold. */
const DEFAULT_LOW_CONF = 0.8;

/** Dosage-form words that may precede a drug name ("Tab Metoprolol"). Ignored for matching only. */
const FORM_WORDS = new Set(['tab', 'tabs', 'tablet', 'cap', 'caps', 'capsule', 'syp', 'syrup', 'inj', 'injection', 'susp']);

export function findDrug(name: string, drugs: DrugEntry[]): DrugEntry | null {
  const toks = normTokens(name);
  while (toks.length > 1 && FORM_WORDS.has(toks[0])) toks.shift();
  const n = toks.join(' ');
  if (!n) return null;
  for (const d of drugs) {
    if (normTokens(d.name).join(' ') === n) return d;
    if (d.aliases.some((a) => normTokens(a).join(' ') === n)) return d;
  }
  return null;
}

/** Token stream over the OCR words, remembering which word each token came from. */
function ocrTokenStream(ocr: OcrPage) {
  const tokens: string[] = [];
  const wordOf: number[] = [];
  ocr.words.forEach((w, wi) => {
    for (const t of normTokens(w.text)) {
      tokens.push(t);
      wordOf.push(wi);
    }
  });
  return { tokens, wordOf };
}

function unionBox(boxes: [number, number, number, number][]): [number, number, number, number] {
  return [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ];
}

function validBox(b: unknown): b is [number, number, number, number] {
  return Array.isArray(b) && b.length === 4 && b.every((x) => typeof x === 'number' && x >= 0 && x <= 1) && b[2] > b[0] && b[3] > b[1];
}

/**
 * OCR and vision cross-check. The model's reading (value) must be supported by an exact OCR quote,
 * and every value token must occur as a whole token in that quote. Anything else is pending_check
 * with a reason. The dictionary only raises flags; it never rewrites a value. A match means the
 * source text supports the reading, not that the interpretation is clinically correct.
 */
export function verifyPageItems(items: ExtractedItem[], ocr: OcrPage | null, drugs: DrugEntry[], opts: { lowConf?: number } = {}): VerifyResult {
  const lowConf = opts.lowConf ?? DEFAULT_LOW_CONF;
  const kept: VerifiedItem[] = [];
  const held_back: VerifyResult['held_back'] = [];
  const stream = ocr ? ocrTokenStream(ocr) : { tokens: [] as string[], wordOf: [] as number[] };

  for (const item of items) {
    if (!PAGE_ITEM_KINDS.includes(item.kind as PageItemKind)) { held_back.push({ item, reason: 'unknown kind' }); continue; }
    if (!item.value || !item.value.trim()) { held_back.push({ item, reason: 'empty value' }); continue; }
    if (item.subject === 'other_person') { held_back.push({ item, reason: 'about another person' }); continue; }
    // "not recorded" / "not established" states an absence; it is not a value and is never shown as one.
    if (/^(not (recorded|established|known|mentioned|available)|n\/?a|nil|none|unknown)/i.test(item.value.trim())) { held_back.push({ item, reason: 'states absence, not a value' }); continue; }

    const reasons: string[] = [];
    let evidence: 'box' | 'page' = 'page';
    let boxes: [number, number, number, number][] = [];
    let precision: VerifiedItem['precision'] = null;
    const quoteTokens = item.ocr_quote ? normTokens(item.ocr_quote) : [];
    const at = quoteTokens.length ? findRun(stream.tokens, quoteTokens) : -1;

    if (at < 0 || !ocr) {
      reasons.push('AI read this from the image; OCR could not confirm it');
    } else {
      const wordIdx = [...new Set(stream.wordOf.slice(at, at + quoteTokens.length))];
      const words = wordIdx.map((i) => ocr.words[i]);
      const wordBoxes = words.map((w) => w.box).filter(validBox);
      const valueTokens = normTokens(item.value);
      const quoteSet = new Set(quoteTokens);
      const supported = valueTokens.length > 0 && valueTokens.every((t) => quoteSet.has(t));
      if (wordBoxes.length === words.length && wordBoxes.length > 0) {
        evidence = 'box';
        boxes = [unionBox(wordBoxes)];
        precision = 'line';
        // Narrow to the value's own words only when it occurs exactly once inside the quote and those
        // words are word-level entries; repeated tokens ("mg ... mg") keep the honest wider box.
        const span = quoteTokens;
        const hits: number[] = [];
        for (let k = 0; k + valueTokens.length <= span.length; k++) if (valueTokens.every((t, j) => span[k + j] === t)) hits.push(k);
        if (supported && hits.length === 1) {
          const vIdx = [...new Set(stream.wordOf.slice(at + hits[0], at + hits[0] + valueTokens.length))];
          const vWords = vIdx.map((i) => ocr.words[i]);
          if (vWords.every((w) => w.level !== 'line' && validBox(w.box))) {
            boxes = [unionBox(vWords.map((w) => w.box))];
            precision = 'word';
          }
        }
        if (words.some((w) => w.level === 'line')) precision = 'line';
      } else {
        reasons.push('OCR text matched but its position could not be validated (page-level evidence)');
      }
      if (!supported) reasons.push(`OCR reads '${item.ocr_quote}', AI reads '${item.value}'`);
      if (words.some((w) => typeof w.conf === 'number' && w.conf < lowConf)) reasons.push('Low OCR confidence');
    }
    if (item.illegible) reasons.push('AI marked this hard to read');

    if (item.kind === 'med_name' && !findDrug(item.value, drugs)) reasons.push('Not in drug list');
    if (item.kind === 'med_strength') {
      const nameItem = items.find((o) => o.group === item.group && o.kind === 'med_name');
      const drug = nameItem ? findDrug(nameItem.value, drugs) : null;
      if (drug) {
        const nums = (item.value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
        if (nums.length === 0 || !nums.every((n) => drug.strengths.includes(n))) reasons.push('Unusual strength for this drug');
      }
    }

    kept.push({ item: item as VerifiedItem['item'], check_state: reasons.length ? 'pending_check' : 'source_matched', evidence, boxes, precision, reasons });
  }
  return { kept, held_back };
}
