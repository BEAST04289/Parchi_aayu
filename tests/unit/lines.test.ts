// Synthetic OCR pages only: deterministic evidence rules for line-cited extraction. Not model accuracy.
import { describe, expect, it } from 'vitest';
import { alignWordsInLine, quoteFromLineIds, type LineCitedItem } from '@/lib/verify/lines';
import { verifyPageItems } from '@/lib/verify/page';
import { DRUGS } from '@/lib/data';
import type { OcrPage, OcrWord } from '@/lib/types';

/** One OCR line per entry; words laid out left to right with distinct real-looking boxes. */
function page(lines: string[], opts: { lineLevel?: number[] } = {}): OcrPage {
  const words: OcrWord[] = [];
  lines.forEach((text, li) => {
    const y = 0.1 + li * 0.05;
    if (opts.lineLevel?.includes(li)) {
      words.push({ i: words.length, text, conf: 0.95, box: [0.05, y, 0.9, y + 0.03], start: 0, end: text.length, level: 'line' });
      return;
    }
    text.split(' ').forEach((w, k) => words.push({ i: words.length, text: w, conf: 0.95, box: [0.05 + k * 0.08, y, 0.05 + k * 0.08 + 0.07, y + 0.03], start: 0, end: 0, level: 'word' }));
  });
  return { text: lines.join('\n'), words, width: 1000, height: 1300, granularity: 'word' };
}
const it_ = (o: Partial<LineCitedItem>): LineCitedItem => ({ group: 1, kind: 'med_strength', value: '', ocr_line_ids: [0], illegible: false, subject: 'patient', assertion: 'present', temporality: 'historical', ...o });
const run = (items: LineCitedItem[], ocr: OcrPage) => verifyPageItems(quoteFromLineIds(items, ocr), ocr, DRUGS, { lowConf: 0.8 });

describe('circular validation: a cited line must support the value', () => {
  const ocr = page(['Tab Metoprolol 25 mg BD']);
  it('"50 mg" citing a line that says "25 mg" is NOT source matched', () => {
    const r = run([it_({ kind: 'med_name', value: 'Metoprolol' }), it_({ value: '50 mg' })], ocr);
    expect(r.kept[1].check_state).toBe('pending_check');
    expect(r.kept[1].reasons.join()).toContain("AI reads '50 mg'");
  });
  it('the supported value citing the same line is source matched with a word-level box', () => {
    const r = run([it_({ kind: 'med_name', value: 'Metoprolol' }), it_({ value: '25 mg' })], ocr);
    expect(r.kept[1].check_state).toBe('source_matched');
    expect(r.kept[1].precision).toBe('word');
    // words: Tab(0) Metoprolol(1) 25(2) mg(3) BD(4) -> union of 25 and mg
    expect(r.kept[1].boxes[0][0]).toBeCloseTo(0.05 + 2 * 0.08);
    expect(r.kept[1].boxes[0][2]).toBeCloseTo(0.05 + 3 * 0.08 + 0.07);
  });
  it('citing no line, a bad id or more than two lines gives no quote (pending, page-level)', () => {
    const three = page(['a', 'b', 'Tab Metoprolol 25 mg BD', 'c']);
    for (const ids of [[], [9], [0, 1, 2], [2, 2]]) {
      const r = run([it_({ value: '25 mg', ocr_line_ids: ids })], three);
      expect(r.kept[0]).toMatchObject({ check_state: 'pending_check', evidence: 'page' });
    }
  });
});

describe('one line with several medicine fields and repeated tokens', () => {
  const ocr = page(['Tab Metformin 500 mg BD Tab Metoprolol 25 mg BD']);
  it('a value that occurs once in the line is highlighted at its own words', () => {
    const r = run([it_({ group: 2, kind: 'med_name', value: 'Metoprolol' }), it_({ group: 2, value: '25 mg' })], ocr);
    const strength = r.kept[1];
    expect(strength.precision).toBe('word');
    // words: Tab0 Metformin1 500(2) mg3 BD4 Tab5 Metoprolol6 25(7) mg8 BD9
    expect(strength.boxes[0][0]).toBeCloseTo(0.05 + 7 * 0.08);
    expect(strength.boxes[0][2]).toBeCloseTo(0.05 + 8 * 0.08 + 0.07);
  });
  it('a repeated value ("BD" twice) keeps the honest line-level box instead of guessing which one', () => {
    const r = run([it_({ group: 2, kind: 'med_frequency', value: 'BD' })], ocr);
    expect(r.kept[0].precision).toBe('line');
    expect(r.kept[0].boxes[0][0]).toBeCloseTo(0.05);
  });
});

describe('word alignment and line fallback', () => {
  it('assigns repeated words to successive occurrences', () => {
    expect(alignWordsInLine('BD x BD', ['BD', 'x', 'BD'])).toEqual([{ start: 0, end: 2 }, { start: 3, end: 4 }, { start: 5, end: 7 }]);
  });
  it('returns null when a word cannot be aligned in order (caller keeps line-level evidence)', () => {
    expect(alignWordsInLine('Metoprolol 25 mg', ['25', 'Metoprolol'])).toBeNull();
    expect(alignWordsInLine('Metoprolol 25 mg', ['Metoprolo1'])).toBeNull();
  });
  it('a line-level OCR entry is never reported as word-precise', () => {
    const ocr = page(['Tab Metoprolol 25 mg BD'], { lineLevel: [0] });
    const r = run([it_({ kind: 'med_name', value: 'Metoprolol' }), it_({ value: '25 mg' })], ocr);
    expect(r.kept[1].check_state).toBe('source_matched');
    expect(r.kept[1].precision).toBe('line');
  });
  it('missing coordinates never become a highlight', () => {
    const ocr = page(['Tab Metoprolol 25 mg BD'], { lineLevel: [0] });
    ocr.words[0].box = [0, 0, 0, 0];
    const r = run([it_({ value: '25 mg' })], ocr);
    expect(r.kept[0]).toMatchObject({ evidence: 'page', check_state: 'pending_check', boxes: [] });
  });
});

describe('negation and family-member allergies on the line-cited path', () => {
  const ocr = page(['No known penicillin allergy.', 'Father has sulfa allergy (not the patient).']);
  it('a denied allergy is kept as denied, a relative\'s allergy is held back', () => {
    const r = run([
      it_({ kind: 'allergy', value: 'Penicillin', assertion: 'denied', ocr_line_ids: [0] }),
      it_({ kind: 'allergy', value: 'Sulfa', subject: 'other_person', ocr_line_ids: [1] }),
    ], ocr);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].item).toMatchObject({ value: 'Penicillin', assertion: 'denied' });
    expect(r.held_back[0].reason).toBe('about another person');
  });
});
