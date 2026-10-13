// Synthetic rows only. Checks brief derivation, stable hashing and review staleness rules.
import { describe, expect, it } from 'vitest';
import { buildBrief } from '@/lib/brief/build';
import type { Bundle } from '@/lib/repo';
import type { AppEvent, Encounter, Fact, Source } from '@/lib/types';

const enc: Encounter = { id: 'e1', token: 't'.repeat(24), alias: 'D1', patient_name: 'Ramesh', patient_age: 52, patient_ref: 'SYN-R52', language: 'hi', voice_consent: null, mode: 'live', status: 'intake', intake_started_at: null, intake_completed_at: null, created_at: '2026-10-13T05:00:00.000Z' };
const src = (o: Partial<Source>): Source => ({ id: 's', encounter_id: 'e1', kind: 'page', seq: 1, label: 'p1', blob_id: 'b', mime: 'image/jpeg', sha256: 'x', status: 'done', processing_started_at: null, error: null, readability: 'readable', identity: 'matched', mode: 'live', model: 'm', provider_info: null, timings: null, ocr: null, doc_type: 'prescription', clinic: 'Clinic A', doc_date: { raw: '14 Aug 2026', iso: '2026-08-14', precision: 'day' }, name_on_doc: 'Ramesh', age_on_doc: '52', id_on_doc: null, width: 1, height: 1, question_id: null, typed_text: null, transcript_hi: null, transcript_en: null, translation_by: null, duration_ms: null, supersedes_id: null, created_at: '2026-10-13T05:01:00.000Z', ...o });
const fact = (o: Partial<Fact>): Fact => ({ id: 'f', encounter_id: 'e1', source_id: 's1', group_key: 's1:g1', kind: 'med_name', value: 'Metoprolol', value_en: null, quote: 'Metoprolol', anchor: { boxes: [[0.1, 0.1, 0.2, 0.2]] }, evidence: 'box', check_state: 'source_matched', reasons: [], subject: 'patient', assertion: 'present', temporality: 'historical', supersedes_id: null, superseded_by: null, created_by: 'system', created_at: '2026-10-13T05:02:00.000Z', ...o });

function bundle(extra: Partial<Bundle> = {}): Bundle {
  return {
    encounter: enc,
    sources: [
      src({ id: 's1', label: 'p1' }),
      src({ id: 's3', seq: 3, label: 'p3', clinic: 'Clinic B', doc_date: { raw: '04 Sep 2026', iso: '2026-09-04', precision: 'day' } }),
      src({ id: 's5', seq: 5, label: 'p5', clinic: 'Clinic C', doc_date: { raw: '10 Sep 2026', iso: '2026-09-10', precision: 'day' } }),
      src({ id: 'a1', seq: 6, kind: 'typed', label: 'a1', typed_text: 'आज पुराने पर्चे दिखाने आया हूँ।', doc_type: null, doc_date: null, blob_id: null }),
    ],
    facts: [
      fact({ id: 'f1', source_id: 's1', group_key: 's1:g1', kind: 'med_name', value: 'Metoprolol' }),
      fact({ id: 'f2', source_id: 's1', group_key: 's1:g1', kind: 'med_strength', value: '25 mg' }),
      fact({ id: 'f3', source_id: 's1', group_key: 's1:g1', kind: 'med_frequency', value: 'BD' }),
      fact({ id: 'f4', source_id: 's3', group_key: 's3:g1', kind: 'med_name', value: 'Metoprolol' }),
      fact({ id: 'f5', source_id: 's3', group_key: 's3:g1', kind: 'med_strength', value: '50 mg', check_state: 'pending_check', reasons: ['Low OCR confidence'] }),
      fact({ id: 'f6', source_id: 's5', group_key: 's5:g1', kind: 'med_name', value: 'Amoxicillin' }),
    ],
    questions: [], events: [], alerts: [],
    ...extra,
  };
}

describe('buildBrief', () => {
  it('shows the typed complaint verbatim with its source', () => {
    const b = buildBrief(bundle());
    expect(b.reason[0]).toMatchObject({ check: 'verbatim', text_hi: 'आज पुराने पर्चे दिखाने आया हूँ।' });
    expect(b.reason[0].refs[0].label).toBe('a1');
  });
  it('groups medicines, orders by document date, expands BD without food timing, flags strength change', () => {
    const b = buildBrief(bundle());
    const met = b.medicines.find((r) => r.key === 'metoprolol')!;
    expect(met.documented.map((e) => e.date_label)).toEqual(['14 Aug 2026', '04 Sep 2026']);
    expect(met.documented[0].fields.find((f) => f.kind === 'med_frequency')!.display).toBe('BD (twice daily)');
    expect(met.flags[0].detail).toBe('25 mg (14 Aug 2026) → 50 mg (04 Sep 2026)');
  });
  it('keeps pending readings visible and lists them in open questions', () => {
    const b = buildBrief(bundle());
    expect(b.open.some((l) => l.id === 'pending-f5')).toBe(true);
    expect(b.ledger.pending_check).toBe(1);
    expect(b.ledger.without_source_link).toBe(0);
  });
  it('timeline uses document dates, not upload order', () => {
    const b = buildBrief(bundle());
    expect(b.timeline.map((t) => t.date_label)).toEqual(['14 Aug 2026', '04 Sep 2026', '10 Sep 2026']);
  });
  it('section hashes are stable across rebuilds and independent of generated_at', () => {
    const a = buildBrief(bundle(), new Date('2026-10-13T06:00:00Z'));
    const c = buildBrief(bundle(), new Date('2026-10-13T07:00:00Z'));
    expect(c.revision).toBe(a.revision);
    expect(c.sections.medicines.hash).toBe(a.sections.medicines.hash);
  });
  it('new allergy page: attention appears with class exposure, attention goes stale, unrelated sections stay reviewed (C13)', () => {
    const before = buildBrief(bundle());
    const review: AppEvent = { id: 'ev1', encounter_id: 'e1', actor: 'Dr Sharma', role: 'doctor', type: 'doctor_review', created_at: '2026-10-13T06:00:00.000Z',
      payload: { section_hashes: Object.fromEntries(Object.entries(before.sections).map(([k, v]) => [k, v.hash])) } };
    const withP4 = bundle({ events: [review] });
    withP4.sources.push(src({ id: 's4', seq: 7, label: 'p4', doc_type: 'history_note', clinic: 'Clinic A' }));
    withP4.facts.push(fact({ id: 'f7', source_id: 's4', group_key: 's4:g1', kind: 'allergy', value: 'Penicillin', quote: 'Penicillin allergy recorded.' }));
    const after = buildBrief(withP4);
    expect(after.attention.map((i) => i.rule_id)).toEqual(['allergy.recorded@1', 'allergy.class_exposure@1']);
    expect(after.attention[0].detail).toContain('Reaction not recorded');
    expect(after.attention[1].detail).toContain('For clinician review; current use unknown');
    expect(after.attention[0].check).toBe('source_matched');
    expect(after.sections.attention.stale).toBe(true);
    expect(after.sections.medicines.stale).toBe(false);
    expect(after.sections.labs.stale).toBe(false);
    expect(after.review_history).toHaveLength(1);
  });
  it('a safety concern built on a pending reading is marked pending', () => {
    const bb = bundle();
    bb.sources.push(src({ id: 's4', seq: 7, label: 'p4', doc_type: 'history_note' }));
    bb.facts.push(fact({ id: 'f9', source_id: 's4', group_key: 's4:g1', kind: 'allergy', value: 'Penicillin', check_state: 'pending_check', reasons: ['Low OCR confidence'] }));
    const b = buildBrief(bb);
    expect(b.attention.find((i) => i.rule_id === 'allergy.recorded@1')!.check).toBe('pending_check');
    expect(b.attention.find((i) => i.rule_id === 'allergy.class_exposure@1')!.check).toBe('pending_check');
  });
  it('"Tab Metoprolol" groups with "Metoprolol" without rewriting the value', () => {
    const bb = bundle();
    bb.facts[3] = { ...bb.facts[3], value: 'Tab Metoprolol' };
    const b = buildBrief(bb);
    const met = b.medicines.find((r) => r.key === 'metoprolol')!;
    expect(met.documented).toHaveLength(2);
    expect(met.documented[1].fields.find((f) => f.kind === 'med_name')!.value).toBe('Tab Metoprolol');
  });
  it('withheld pages contribute no facts and raise an identity check (C11)', () => {
    const bb = bundle();
    bb.sources[2] = { ...bb.sources[2], identity: 'withheld', name_on_doc: 'Sita' };
    const b = buildBrief(bb);
    expect(b.medicines.find((r) => r.key === 'amoxicillin')).toBeUndefined();
    expect(b.attention.some((i) => i.rule_id === 'doc.identity_mismatch@1')).toBe(true);
  });
  it('a denied allergy is never shown as an allergy (C01)', () => {
    const bb = bundle();
    bb.facts.push(fact({ id: 'f8', source_id: 's1', group_key: 's1:g2', kind: 'allergy', value: 'Penicillin', assertion: 'denied', quote: 'No known penicillin allergy' }));
    const b = buildBrief(bb);
    expect(b.attention.some((i) => i.rule_id.startsWith('allergy'))).toBe(false);
    expect(b.open.some((l) => l.text.includes('Not proof of no allergies'))).toBe(true);
  });
  it('a corrected answer replaces the old one in the brief but not in history', () => {
    const bb = bundle();
    bb.sources.push(src({ id: 'a2', seq: 8, kind: 'typed', label: 'a2', typed_text: 'तीन दिन से पेट में जलन है', supersedes_id: 'a1', doc_type: null, doc_date: null, blob_id: null }));
    const b = buildBrief(bb);
    expect(b.reason.filter((l) => l.check === 'verbatim').map((l) => l.text_hi)).toEqual(['तीन दिन से पेट में जलन है']);
  });

  it('a "denied" allergy whose own sentence has no negation word stays in Attention, pending (D12 regression)', () => {
    const bb = bundle();
    bb.sources.push(src({ id: 's4', seq: 4, label: 'p4', doc_type: 'history_note' }));
    bb.facts.push(fact({ id: 'f10', source_id: 's4', group_key: 's4:g1', kind: 'allergy', value: 'Penicillin', assertion: 'denied', quote: 'Penicillin allergy recorded. Reaction details and reaction date: not recorded.' }));
    const b = buildBrief(bb);
    const a = b.attention.find((i) => i.rule_id === 'allergy.recorded@1')!;
    expect(a.title).toBe('Penicillin allergy mentioned (wording unclear)');
    expect(a.check).toBe('pending_check');
    expect(b.attention.find((i) => i.rule_id === 'allergy.class_exposure@1')!.check).toBe('pending_check');
    expect(b.open.some((l) => l.id === 'denied-f10')).toBe(false);
  });

  it('"Patient allergy recorded: Penicillin." marked denied is still shown; "No known penicillin allergy" stays a documented negative', () => {
    const bb = bundle();
    bb.facts.push(fact({ id: 'f11', source_id: 's1', group_key: 's1:g3', kind: 'allergy', value: 'Penicillin', assertion: 'denied', quote: 'Patient allergy recorded: Penicillin.' }));
    expect(buildBrief(bb).attention.some((i) => i.id === 'allergy-f11')).toBe(true);
    const cc = bundle();
    cc.facts.push(fact({ id: 'f12', source_id: 's1', group_key: 's1:g3', kind: 'allergy', value: 'Penicillin', assertion: 'denied', quote: 'No known penicillin allergy' }));
    const c = buildBrief(cc);
    expect(c.attention.some((i) => i.rule_id.startsWith('allergy'))).toBe(false);
    expect(c.open.some((l) => l.id === 'denied-f12')).toBe(true);
  });

  it('an uncertain allergy is shown in Attention, pending, never dropped', () => {
    const bb = bundle();
    bb.facts.push(fact({ id: 'f13', source_id: 's1', group_key: 's1:g4', kind: 'allergy', value: 'Sulfa', assertion: 'uncertain', quote: 'Sulfa allergy?' }));
    const a = buildBrief(bb).attention.find((i) => i.id === 'allergy-f13')!;
    expect(a.check).toBe('pending_check');
  });

  it('the same words extracted under several kinds from one answer are shown once', () => {
    const bb = bundle();
    for (const [i, kind] of (['complaint', 'visit_reason', 'patient_concern'] as const).entries()) bb.facts.push(fact({ id: `r${i}`, source_id: 'a1', group_key: null, kind, value: 'i have chest ache', quote: 'i have chest ache' }));
    const lines = buildBrief(bb).reason.filter((l) => l.check !== 'verbatim');
    expect(lines.map((l) => l.text_hi)).toEqual(['i have chest ache']);
  });

  it('a page whose readings were all held back says so instead of "no facts extracted"', () => {
    const bb = bundle();
    bb.sources.push(src({ id: 's9', seq: 9, label: 'p9', timings: { held_back: 5 } }));
    const line = buildBrief(bb).open.find((l) => l.id === 'nofacts-s9')!;
    expect(line.text).toContain('5 AI reading(s) were held back');
  });
});
