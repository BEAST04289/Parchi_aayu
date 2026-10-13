import type { OcrPage, OcrWord } from '../types';

/**
 * Pure helpers for line-cited extraction (local/free models). Kept free of server-only imports so the
 * circular-validation rules are unit-tested.
 */

/** OCR lines exactly as numbered for the model. */
export function ocrLines(ocr: OcrPage): string[] {
  return ocr.granularity === 'line' ? ocr.words.map((w) => w.text) : ocr.text.split('\n');
}

export interface LineCitedItem {
  group: number; kind: string; value: string; ocr_line_ids: number[]; illegible: boolean;
  subject: 'patient' | 'other_person' | 'unknown'; assertion: 'present' | 'denied' | 'uncertain'; temporality: 'current' | 'historical' | 'unknown';
}

/**
 * Builds ocr_quote from the cited OCR lines. This only proves the quote EXISTS in the OCR output; it is
 * not support for the value. Support is checked afterwards by verifyPageItems: every value token must
 * appear as a whole token in the cited line ("50 mg" citing "Metoprolol 25 mg" -> pending).
 * More than two lines, duplicate or out-of-range ids -> no quote (pending, page-level).
 */
export function quoteFromLineIds<T extends LineCitedItem>(items: T[], ocr: OcrPage): (Omit<T, 'ocr_line_ids'> & { ocr_quote: string | null })[] {
  const lines = ocrLines(ocr);
  return items.map(({ ocr_line_ids, ...it }) => {
    const unique = [...new Set(ocr_line_ids)];
    const ids = unique.filter((i) => Number.isInteger(i) && i >= 0 && i < lines.length).sort((a, b) => a - b);
    const valid = ids.length > 0 && ids.length <= 2 && ids.length === unique.length && ids.length === ocr_line_ids.length;
    return { ...it, ocr_quote: valid ? ids.map((i) => lines[i]).join(' ') : null };
  });
}

/**
 * Assigns each OCR word its real character range inside its line, scanning left to right so repeated
 * words map to successive occurrences. Returns null if any word cannot be aligned in order; the caller
 * then keeps honest line-level evidence for that line instead of inventing positions.
 */
export function alignWordsInLine(lineText: string, words: string[]): { start: number; end: number }[] | null {
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const w of words) {
    const at = lineText.indexOf(w, cursor);
    if (at < 0 || w.length === 0) return null;
    out.push({ start: at, end: at + w.length });
    cursor = at + w.length;
  }
  return out;
}

export type { OcrWord };
