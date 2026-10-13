// Synthetic inputs only. These tests check deterministic rules; they say nothing about live OCR/model accuracy.
import { describe, expect, it } from 'vitest';
import { findRun, normTokens, quoteFoundIn } from '@/lib/verify/normalize';
import { verifyPageItems, type ExtractedItem, type DrugEntry } from '@/lib/verify/page';
import { parseDocDate, dateLabel } from '@/lib/verify/dates';
import { checkIdentity, parseAge } from '@/lib/verify/identity';
import { labStatus } from '@/lib/brief/build';
import { matchUrgent, DRUGS } from '@/lib/data';
import type { OcrPage } from '@/lib/types';

/** Builds a synthetic OCR page from text, one word per whitespace token, boxes laid out left to right. */
function ocrOf(text: string, conf = 0.95): OcrPage {
  const words = text.split(/\s+/).filter(Boolean).map((w, i) => ({ i, text: w, conf, box: [0.05 * i, 0.1, 0.05 * i + 0.04, 0.14] as [number, number, number, number], start: 0, end: 0 }));
  return { text, words, width: 1000, height: 1400 };
}
const item = (over: Partial<ExtractedItem>): ExtractedItem => ({ group: 1, kind: 'med_strength', value: '', ocr_quote: null, illegible: false, subject: 'patient', assertion: 'present', temporality: 'historical', ...over });
const drugs: DrugEntry[] = DRUGS;

describe('normTokens', () => {
  it('keeps decimals between digits', () => expect(normTokens('Tab 12.5mg')).toEqual(['tab', '12.5', 'mg']));
  it('splits digit/letter boundaries', () => expect(normTokens('50mg')).toEqual(['50', 'mg']));
  it('turns punctuation into separators', () => expect(normTokens('Metoprolol|25 mg|BD.')).toEqual(['metoprolol', '25', 'mg', 'bd']));
  it('keeps Devanagari matras', () => expect(normTokens('सफेद गोली।')).toEqual(['सफेद', 'गोली']));
  it('finds contiguous runs only', () => {
    expect(findRun(['a', 'b', 'c'], ['b', 'c'])).toBe(1);
    expect(findRun(['a', 'b', 'c'], ['a', 'c'])).toBe(-1);
  });
  it('finds a Devanagari quote in a transcript', () => expect(quoteFoundIn('सफेद गोली', 'दवा का नाम याद नहीं है। सफेद गोली लेता हूँ।')).toBe(true));
});

describe('verifyPageItems (OCR and vision cross-check)', () => {
  const ocr = ocrOf('Tab Metoprolol 25 mg BD');
  const nameItem = item({ kind: 'med_name', value: 'Metoprolol', ocr_quote: 'Metoprolol' });
  it('source-matches an exact reading and returns a box', () => {
    const r = verifyPageItems([nameItem, item({ value: '25 mg', ocr_quote: 'Metoprolol 25 mg' })], ocr, drugs);
    expect(r.kept.map((k) => k.check_state)).toEqual(['source_matched', 'source_matched']);
    expect(r.kept[1].evidence).toBe('box');
    expect(r.kept[1].precision).toBe('word');
    expect(r.kept[1].boxes[0][0]).toBeCloseTo(0.10); // narrowed to the '25' 'mg' words, not the whole quote
  });
  it('25 vs 250 -> pending (no fuzzy numbers)', () => {
    const r = verifyPageItems([nameItem, item({ value: '250 mg', ocr_quote: 'Metoprolol 25 mg' })], ocr, drugs);
    expect(r.kept[1].check_state).toBe('pending_check');
    expect(r.kept[1].reasons.join()).toContain("AI reads '250 mg'");
  });
  it('12.5 vs 125 -> pending', () => {
    const r = verifyPageItems([item({ kind: 'med_name', value: 'Metoprolol', ocr_quote: 'Metoprolol' }), item({ value: '12.5 mg', ocr_quote: '125 mg' })], ocrOf('Metoprolol 125 mg'), drugs);
    expect(r.kept[1].check_state).toBe('pending_check');
  });
  it('BD vs OCR 8D -> pending', () => {
    const r = verifyPageItems([item({ kind: 'med_frequency', value: 'BD', ocr_quote: '8D' })], ocrOf('Metoprolol 25 mg 8D'), drugs);
    expect(r.kept[0].check_state).toBe('pending_check');
  });
  it('"50mg" vs "50 mg" agree', () => {
    const r = verifyPageItems([item({ kind: 'med_name', value: 'Metoprolol', ocr_quote: 'Metoprolol' }), item({ value: '50 mg', ocr_quote: '50mg' })], ocrOf('Metoprolol 50mg BD'), drugs);
    expect(r.kept[1].check_state).toBe('source_matched');
  });
  it('missing quote -> page-level pending', () => {
    const r = verifyPageItems([item({ kind: 'med_frequency', value: 'TDS', ocr_quote: null })], ocr, drugs);
    expect(r.kept[0]).toMatchObject({ check_state: 'pending_check', evidence: 'page' });
  });
  it('quote not in OCR -> pending', () => {
    const r = verifyPageItems([item({ kind: 'med_frequency', value: 'BD', ocr_quote: 'Metoprolol BD' })], ocr, drugs);
    expect(r.kept[0].check_state).toBe('pending_check');
  });
  it('low OCR confidence -> pending', () => {
    const r = verifyPageItems([item({ kind: 'med_frequency', value: 'BD', ocr_quote: 'BD' })], ocrOf('Tab Metoprolol 25 mg BD', 0.5), drugs);
    expect(r.kept[0].reasons).toContain('Low OCR confidence');
  });
  it('"Tab Metoprolol" is recognised for matching only', () => {
    const r = verifyPageItems([item({ kind: 'med_name', value: 'Tab Metoprolol', ocr_quote: 'Tab Metoprolol' })], ocr, drugs);
    expect(r.kept[0].check_state).toBe('source_matched');
    expect(r.kept[0].item.value).toBe('Tab Metoprolol');
  });
  it('unknown drug and unusual strength are flagged, never rewritten', () => {
    const r = verifyPageItems([item({ kind: 'med_name', value: 'Metopsolol', ocr_quote: 'Metopsolol' })], ocrOf('Metopsolol 25 mg'), drugs);
    expect(r.kept[0]).toMatchObject({ check_state: 'pending_check' });
    expect(r.kept[0].item.value).toBe('Metopsolol');
    const r2 = verifyPageItems([nameItem, item({ value: '30 mg', ocr_quote: '30 mg' })], ocrOf('Metoprolol 30 mg'), drugs);
    expect(r2.kept[1].reasons).toContain('Unusual strength for this drug');
  });
  it('drops another person\'s allergy (C02) and empty values', () => {
    const r = verifyPageItems([item({ kind: 'allergy', value: 'Penicillin', ocr_quote: 'Penicillin', subject: 'other_person' }), item({ value: '  ' })], ocrOf('father Penicillin allergy'), drugs);
    expect(r.kept).toHaveLength(0);
    expect(r.held_back).toHaveLength(2);
  });
  it('invalid OCR boxes fall back to page-level evidence', () => {
    const bad = ocrOf('Metoprolol 25 mg');
    bad.words.forEach((w) => (w.box = [0, 0, 0, 0]));
    const r = verifyPageItems([item({ kind: 'med_name', value: 'Metoprolol', ocr_quote: 'Metoprolol' })], bad, drugs);
    expect(r.kept[0].evidence).toBe('page');
    expect(r.kept[0].check_state).toBe('pending_check');
  });
});

describe('parseDocDate', () => {
  it('month in words is exact', () => expect(parseDocDate('04 Sep 2026')).toMatchObject({ iso: '2026-09-04', precision: 'day' }));
  it('day > 12 is unambiguous DD/MM', () => expect(parseDocDate('25/08/2026')).toMatchObject({ iso: '2026-08-25' }));
  it('03/04/2026 is labelled as an assumption (C06)', () => {
    const d = parseDocDate('03/04/2026');
    expect(d.assumed_dmy).toBe(true);
    expect(dateLabel(d)).toContain('assumed DD/MM');
  });
  it('missing date stays missing (never upload time)', () => expect(parseDocDate(null)).toMatchObject({ iso: null, precision: 'unknown' }));
  it('impossible numeric date -> unknown', () => expect(parseDocDate('08/25/2026')).toMatchObject({ iso: null }));
});

describe('checkIdentity (lenient)', () => {
  const enc = { patient_name: 'Ramesh', patient_age: 52, patient_ref: 'SYN-R52' };
  it('matches the demo pages', () => expect(checkIdentity(enc, { name: 'Ramesh', age: '52 years', id: null })).toBe('matched'));
  it('tolerates small spelling differences', () => expect(checkIdentity(enc, { name: 'Ramesh Kumar', age: '52 M', id: null })).toBe('matched'));
  it('matches by ID', () => expect(checkIdentity(enc, { name: 'R.', age: null, id: 'SYN R52' })).toBe('matched'));
  it('ignores label words before the name', () => {
    expect(checkIdentity(enc, { name: 'Name: Ramesh', age: '52', id: null })).toBe('matched');
    expect(checkIdentity(enc, { name: 'Pt. Ramesh', age: null, id: null })).toBe('matched');
    expect(checkIdentity(enc, { name: 'Patient: Ramesh Kumar', age: '52 years', id: null })).toBe('matched');
    expect(checkIdentity(enc, { name: 'Shri Ramesh', age: '52 M', id: null })).toBe('matched');
  });
  it('close name but different age is unchecked, never withheld (possible misread)', () => expect(checkIdentity(enc, { name: 'Ramesh', age: '62', id: null })).toBe('unchecked'));
  it('withholds a clearly different person (C11)', () => expect(checkIdentity(enc, { name: 'Sita', age: '34', id: 'SYN-S34' })).toBe('withheld'));
  it('no name -> unchecked, not withheld', () => expect(checkIdentity(enc, { name: null, age: null, id: null })).toBe('unchecked'));
  it('parses ages', () => expect([parseAge('52'), parseAge('52 M'), parseAge('52y'), parseAge('52/M')]).toEqual([52, 52, 52, 52]));
});

describe('labStatus (report-specific ranges only)', () => {
  it('below range', () => expect(labStatus('12.9', 'g/dL', '13.0 - 17.0 g/dL')).toBe('below'));
  it('within range', () => expect(labStatus('1.1', 'mg/dL', '0.7 - 1.3 mg/dL')).toBe('within'));
  it('missing range -> unclassified (C07)', () => expect(labStatus('12.9', 'g/dL', null)).toBe('unclassified'));
  it('comparator -> unclassified', () => expect(labStatus('<5', 'mg/L', '0 - 5 mg/L')).toBe('unclassified'));
  it('unit mismatch -> unclassified', () => expect(labStatus('12.9', 'g/L', '13.0 - 17.0 g/dL')).toBe('unclassified'));
});

describe('matchUrgent (deterministic, not triage)', () => {
  it('matches the demo urgent phrase', () => expect(matchUrgent('अभी सीने में तेज दर्द हो रहा है।')?.group).toBe('chest_pain'));
  it('matches romanized Hinglish', () => expect(matchUrgent('saans nahi aa rahi')?.group).toBe('breathing'));
  it('does not match a routine visit', () => expect(matchUrgent('आज पुराने पर्चे और रिपोर्ट दिखाने आया हूँ।')).toBeNull());
});
