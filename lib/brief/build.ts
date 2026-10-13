import { canonicalJson, sha1Hex } from '../hash';
import { dateLabel } from '../verify/dates';
import { findDrug } from '../verify/page';
import { findRun, normTokens } from '../verify/normalize';
import { ALLERGY_CLASSES, DRUGS, candidateText } from '../data';
import type {
  AppEvent, Brief, BriefLine, Fact, FactKind, FieldRef, Issue, LabRow, MedEntry, MedRow, PageSummary,
  SectionKey, SectionState, Source, SourceRef, TimelineEvent,
} from '../types';
import { SECTION_KEYS } from '../types';
import type { Bundle } from '../repo';

/**
 * Pure: recomputes the whole clinician brief from stored rows on every read. Nothing derived is
 * stored. Section hashes cover clinical content only (no timestamps, timers, URLs or alert status),
 * so they change only when what the doctor would read changes.
 */

const FREQ: Record<string, string> = {
  od: 'once daily', bd: 'twice daily', bid: 'twice daily', tds: 'three times daily', tid: 'three times daily',
  qid: 'four times daily', hs: 'at bedtime', sos: 'when required',
};
const DOC_TYPE: Record<string, string> = { prescription: 'Prescription', lab_report: 'Lab report', history_note: 'History note', other: 'Document' };
const MED_ORDER: FactKind[] = ['med_name', 'med_strength', 'med_frequency', 'med_form', 'med_duration'];

export function displayValue(f: Pick<Fact, 'kind' | 'value'>): string {
  if (f.kind === 'med_frequency') {
    const k = normTokens(f.value).join('');
    return FREQ[k] ? `${f.value} (${FREQ[k]})` : f.value;
  }
  return f.value;
}

function isHumanChecked(f: Fact) {
  return f.check_state === 'nurse_confirmed' || f.check_state === 'nurse_corrected' || f.check_state === 'unreadable';
}

export function buildBrief(b: Bundle, now: Date = new Date()): Brief {
  const srcById = new Map(b.sources.map((s) => [s.id, s]));
  const withheld = new Set(b.sources.filter((s) => s.identity === 'withheld' || s.identity === 'mismatch').map((s) => s.id));
  // Answers replaced by a patient correction stay in history but no longer feed the brief.
  const supersededSources = new Set(b.sources.map((s) => s.supersedes_id).filter(Boolean) as string[]);
  const facts = b.facts.filter((f) => !withheld.has(f.source_id) && !supersededSources.has(f.source_id) && f.subject !== 'other_person');
  const label = (id: string) => srcById.get(id)?.label ?? '?';
  const ref = (sourceId: string, factIds: string[] = []): SourceRef => ({ source_id: sourceId, label: label(sourceId), fact_ids: factIds });
  const field = (f: Fact): FieldRef => ({
    fact_id: f.id, kind: f.kind, value: f.value, display: displayValue(f), check: f.check_state, reasons: f.reasons ?? [],
    source_id: f.source_id, source_label: label(f.source_id),
  });
  const srcDate = (s: Source | undefined) => ({ iso: s?.doc_date?.iso ?? null, label: dateLabel(s?.doc_date ?? null) });
  const where = (s: Source | undefined) => [s?.clinic, srcDate(s).label].filter(Boolean).join(' · ') || s?.label || '';

  // ---------- Reason for visit ----------
  const reason: BriefLine[] = [];
  for (const s of b.sources) {
    if ((s.kind !== 'typed' && s.kind !== 'clip') || supersededSources.has(s.id)) continue;
    const words = s.kind === 'typed' ? s.typed_text : s.transcript_hi;
    if (!words) continue;
    const q = s.question_id ? b.questions.find((x) => x.id === s.question_id) : undefined;
    reason.push({
      id: `ans-${s.id}`, text: s.transcript_en ?? words, text_hi: words, text_en_by: s.transcript_en ? s.translation_by : null,
      refs: [ref(s.id)], check: 'verbatim', origin: 'patient_reported',
      ...(q ? { asked: candidateText(q.candidate_id)?.en ?? q.candidate_id } : {}),
    });
  }
  for (const f of facts.filter((x) => ['visit_reason', 'complaint', 'onset', 'duration', 'patient_concern'].includes(x.kind))) {
    reason.push({ id: `fact-${f.id}`, text: f.value_en ?? f.value, text_hi: f.value, refs: [ref(f.source_id, [f.id])], fields: [field(f)], check: f.check_state, origin: 'patient_reported' });
  }

  // ---------- Medicines ----------
  const rows = new Map<string, MedRow>();
  const medFacts = facts.filter((f) => MED_ORDER.includes(f.kind));
  const groups = new Map<string, Fact[]>();
  for (const f of medFacts) {
    const g = f.group_key ?? `${f.source_id}:${f.id}`;
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  for (const [g, fs] of groups) {
    const nameFact = fs.find((f) => f.kind === 'med_name');
    const drug = nameFact ? findDrug(nameFact.value, DRUGS) : null;
    const key = drug ? drug.name.toLowerCase() : nameFact ? normTokens(nameFact.value).join(' ') : `unnamed:${g}`;
    const s = srcById.get(fs[0].source_id);
    const entry: MedEntry = {
      group_key: g, date_iso: srcDate(s).iso, date_label: srcDate(s).label, source_id: fs[0].source_id, source_label: label(fs[0].source_id),
      fields: [...fs].sort((a, c) => MED_ORDER.indexOf(a.kind) - MED_ORDER.indexOf(c.kind)).map(field),
    };
    const row = rows.get(key) ?? { key, name: nameFact?.value ?? 'Medicine name not read', documented: [], patient_reports: [], flags: [] };
    row.documented.push(entry);
    rows.set(key, row);
  }
  for (const f of facts.filter((x) => x.kind === 'med_reported_taking')) {
    const text = normTokens(`${f.value} ${f.value_en ?? ''}`);
    let target: MedRow | undefined;
    for (const r of rows.values()) if (findRun(text, normTokens(r.name)) >= 0) target = r;
    if (!target) {
      target = rows.get('__patient') ?? { key: '__patient', name: 'Patient-reported (not matched to a document)', documented: [], patient_reports: [], flags: [] };
      rows.set('__patient', target);
    }
    target.patient_reports.push(field(f));
  }
  for (const r of rows.values()) {
    r.documented.sort((a, c) => (a.date_iso ?? '9999').localeCompare(c.date_iso ?? '9999'));
    const strengths = r.documented.map((e) => ({ e, s: e.fields.find((x) => x.kind === 'med_strength') })).filter((x) => x.s);
    const distinct = [...new Set(strengths.map((x) => normTokens(x.s!.value).join(' ')))];
    if (distinct.length > 1) {
      r.flags.push({
        id: `flag-strength-${r.key}`, rule_id: 'med.strength_changed@1', level: 'review', section: 'medicines',
        title: 'Documented strength changed',
        detail: strengths.map((x) => `${x.s!.value}${x.e.date_label ? ` (${x.e.date_label})` : ''}`).join(' → '),
        fact_ids: strengths.map((x) => x.s!.fact_id), refs: strengths.map((x) => ref(x.e.source_id, [x.s!.fact_id])),
      });
    }
  }
  const medicines = [...rows.values()].sort((a, c) => (a.key === '__patient' ? 1 : c.key === '__patient' ? -1 : a.name.localeCompare(c.name)));

  // ---------- Labs ----------
  const labGroups = new Map<string, Fact[]>();
  for (const f of facts.filter((x) => x.kind.startsWith('lab_'))) {
    const g = f.group_key ?? `${f.source_id}:${f.id}`;
    labGroups.set(g, [...(labGroups.get(g) ?? []), f]);
  }
  const labs: LabRow[] = [...labGroups.entries()].map(([g, fs]) => {
    const pick = (k: FactKind) => { const f = fs.find((x) => x.kind === k); return f ? field(f) : null; };
    const s = srcById.get(fs[0].source_id);
    const value = pick('lab_value'), unit = pick('lab_unit'), range = pick('lab_range');
    return { key: g, name: pick('lab_name'), value, unit, range, status: labStatus(value?.value, unit?.value, range?.value), date_label: srcDate(s).label, source_id: fs[0].source_id, source_label: label(fs[0].source_id) };
  }).sort((a, c) => (srcById.get(c.source_id)?.doc_date?.iso ?? '').localeCompare(srcById.get(a.source_id)?.doc_date?.iso ?? ''));

  // ---------- Timeline ----------
  const timeline: TimelineEvent[] = [];
  const undated: TimelineEvent[] = [];
  for (const s of b.sources.filter((x) => x.kind === 'page' && x.status === 'done' && !withheld.has(x.id))) {
    const title = [DOC_TYPE[s.doc_type ?? 'other'] ?? 'Document', s.clinic].filter(Boolean).join(' · ');
    if (s.doc_date?.iso) timeline.push({ date_iso: s.doc_date.iso, date_label: dateLabel(s.doc_date)!, title, refs: [ref(s.id)] });
    else undated.push({ date_iso: null, date_label: s.doc_date?.raw ? `Date unclear: “${s.doc_date.raw}”` : 'No date found on page', title, refs: [ref(s.id)] });
  }
  timeline.sort((a, c) => a.date_iso!.localeCompare(c.date_iso!) || a.refs[0].label.localeCompare(c.refs[0].label));

  // ---------- Attention ----------
  const attention: Issue[] = [];
  for (const a of facts.filter((x) => x.kind === 'allergy' && x.assertion === 'present')) {
    const s = srcById.get(a.source_id);
    const reaction = facts.find((x) => x.kind === 'allergy_reaction' && x.group_key && x.group_key === a.group_key);
    attention.push({
      id: `allergy-${a.id}`, rule_id: 'allergy.recorded@1', level: 'allergy', section: 'attention',
      title: `${a.value} allergy recorded`,
      detail: `${where(s)}. ${reaction ? `Reaction recorded: ${reaction.value}.` : 'Reaction not recorded.'}`,
      fact_ids: [a.id, ...(reaction ? [reaction.id] : [])], refs: [ref(a.source_id, [a.id, ...(reaction ? [reaction.id] : [])])],
    });
    const aTokens = normTokens(a.value);
    const cls = ALLERGY_CLASSES.find((c) => c.allergy_terms.some((t) => findRun(aTokens, normTokens(t)) >= 0));
    if (!cls) continue;
    for (const m of facts.filter((x) => x.kind === 'med_name')) {
      const drug = findDrug(m.value, DRUGS);
      if (!drug || drug.class !== cls.drug_class) continue;
      const ms = srcById.get(m.source_id);
      attention.push({
        id: `class-${a.id}-${m.id}`, rule_id: 'allergy.class_exposure@1', level: 'allergy', section: 'attention',
        title: `${m.value} (a ${cls.label_en}) was prescribed${srcDate(ms).label ? ` ${srcDate(ms).label}` : ''}${ms?.clinic ? ` · ${ms.clinic}` : ''}`,
        detail: `${a.value} allergy is recorded (${a.source_id === m.source_id ? 'same page' : label(a.source_id)}). For clinician review; current use unknown.`,
        fact_ids: [a.id, m.id], refs: [ref(m.source_id, [m.id]), ref(a.source_id, [a.id])],
      });
    }
  }
  const factById = new Map(facts.map((f) => [f.id, f]));
  for (const i of attention) {
    const states = i.fact_ids.map((id) => factById.get(id)?.check_state).filter(Boolean) as Fact['check_state'][];
    if (states.some((s) => s === 'pending_check' || s === 'unreadable')) i.check = 'pending_check';
    else if (states.length) i.check = states.every((s) => s === states[0]) ? states[0] : 'mixed';
  }
  for (const s of b.sources.filter((x) => withheld.has(x.id))) {
    attention.push({
      id: `identity-${s.id}`, rule_id: 'doc.identity_mismatch@1', level: 'review', section: 'attention',
      title: `${s.label} names ${s.name_on_doc ?? 'someone else'}${s.age_on_doc ? `, ${s.age_on_doc}` : ''}`,
      detail: 'Withheld from this brief pending identity check.', fact_ids: [], refs: [ref(s.id)],
    });
  }

  // ---------- Open questions and coverage ----------
  const open: BriefLine[] = [];
  for (const f of facts.filter((x) => x.kind === 'allergy' && x.assertion === 'denied')) {
    open.push({ id: `denied-${f.id}`, text: `Documented negative statement: “${f.quote ?? f.value}”. Not proof of no allergies.`, refs: [ref(f.source_id, [f.id])], fields: [field(f)], check: f.check_state, origin: 'documented' });
  }
  for (const f of facts.filter((x) => x.check_state === 'pending_check')) {
    open.push({ id: `pending-${f.id}`, text: `Pending source check: ${f.kind.replace(/_/g, ' ')} “${displayValue(f)}” — ${(f.reasons ?? []).join('; ')}`, refs: [ref(f.source_id, [f.id])], fields: [field(f)], check: 'pending_check', origin: 'documented' });
  }
  for (const s of b.sources.filter((x) => x.kind === 'page')) {
    if (s.status === 'failed') open.push({ id: `failed-${s.id}`, text: `${s.label} was not processed: ${s.error ?? 'unknown error'} The original page is stored.`, refs: [ref(s.id)], check: 'pending_check', origin: 'rule' });
    else if (s.status === 'done' && s.readability === 'unreadable') open.push({ id: `retake-${s.id}`, text: `${s.label} could not be read. Ask for a clearer photo.`, refs: [ref(s.id)], check: 'pending_check', origin: 'rule' });
    else if (s.status === 'done' && !withheld.has(s.id) && !b.facts.some((f) => f.source_id === s.id))
      open.push({ id: `nofacts-${s.id}`, text: `${s.label}: no structured facts extracted. Review the original page; this does not mean it has no medicines or allergies.`, refs: [ref(s.id)], check: 'pending_check', origin: 'rule' });
  }
  for (const q of b.questions.filter((x) => x.state === 'unknown' || x.state === 'skipped')) {
    const t = candidateText(q.candidate_id);
    open.push({ id: `q-${q.id}`, text: `${q.state === 'unknown' ? 'Patient did not know' : 'Patient skipped'}: ${t?.en ?? q.candidate_id}`, refs: [], check: 'mixed', origin: 'patient_reported' });
  }

  // ---------- Ledger (citation coverage, not proof of correct interpretation) ----------
  const counted: { refs: number }[] = [
    ...reason.map((l) => ({ refs: l.refs.length })),
    ...medicines.flatMap((r) => [...r.documented.map((e) => ({ refs: e.fields.length })), ...r.patient_reports.map(() => ({ refs: 1 }))]),
    ...labs.map((l) => ({ refs: [l.name, l.value, l.unit, l.range].filter(Boolean).length })),
    ...timeline.map((t) => ({ refs: t.refs.length })), ...undated.map((t) => ({ refs: t.refs.length })),
    ...attention.map((i) => ({ refs: i.refs.length })),
  ];
  const ledger = {
    lines: counted.length,
    with_source_link: counted.filter((c) => c.refs > 0).length,
    without_source_link: counted.filter((c) => c.refs === 0).length,
    pending_check: facts.filter((f) => f.check_state === 'pending_check').length,
    human_checked: facts.filter(isHumanChecked).length,
    held_back: b.sources.reduce((n, s) => n + (Number(s.timings?.held_back) || 0), 0),
  };

  // ---------- Hashes and review state ----------
  const content: Record<SectionKey, unknown> = { attention, reason, medicines, labs, timeline: { timeline, undated }, open };
  const hashes = Object.fromEntries(SECTION_KEYS.map((k) => [k, sha1Hex(canonicalJson(content[k]))])) as Record<SectionKey, string>;
  const reviews = b.events.filter((e) => e.type === 'doctor_review');
  const last: AppEvent | undefined = reviews[reviews.length - 1];
  const reviewed = (last?.payload?.section_hashes ?? {}) as Partial<Record<SectionKey, string>>;
  const sections = Object.fromEntries(SECTION_KEYS.map((k) => {
    const st: SectionState = {
      hash: hashes[k], reviewed_hash: reviewed[k] ?? null, reviewed_at: last && reviewed[k] ? last.created_at : null, reviewed_by: last && reviewed[k] ? last.actor : null,
      stale: !!reviewed[k] && reviewed[k] !== hashes[k], never_reviewed: !reviewed[k],
    };
    return [k, st];
  })) as Record<SectionKey, SectionState>;

  const pages: PageSummary[] = b.sources.filter((s) => s.kind === 'page').map((s) => ({
    id: s.id, label: s.label, kind: s.kind, status: s.status, error: s.error, readability: s.readability, identity: s.identity, mode: s.mode,
    doc_type: s.doc_type, clinic: s.clinic, date_label: dateLabel(s.doc_date), seq: s.seq,
  }));
  const pageSources = b.sources.filter((s) => s.kind === 'page');
  const alerts = b.alerts.filter((a) => !a.resumed_at);
  const live_hash = sha1Hex(canonicalJson({
    pages: pages.map((p) => [p.id, p.status, p.readability, p.identity, p.error]),
    alerts: b.alerts.map((a) => [a.id, !!a.delivered_at, !!a.acked_at, !!a.resumed_at]),
    status: b.encounter.status, mode: b.encounter.mode, answers: b.sources.filter((s) => s.kind !== 'page').length,
    reviews: reviews.length,
  }));
  const started = b.encounter.intake_started_at ? Date.parse(b.encounter.intake_started_at) : null;
  const done = b.encounter.intake_completed_at ? Date.parse(b.encounter.intake_completed_at) : null;

  return {
    encounter: b.encounter,
    revision: sha1Hex(SECTION_KEYS.map((k) => hashes[k]).join(':')),
    live_hash,
    generated_at: now.toISOString(),
    coverage: {
      pages: pageSources.length,
      read: pageSources.filter((s) => s.status === 'done' && !withheld.has(s.id) && s.readability !== 'unreadable').length,
      processing: pageSources.filter((s) => s.status === 'processing' || s.status === 'uploaded').length,
      failed: pageSources.filter((s) => s.status === 'failed').length,
      withheld: withheld.size,
      answers: b.sources.filter((s) => s.kind !== 'page').length,
    },
    pages, attention, reason, medicines, labs, timeline, undated, open, ledger, sections, alerts,
    review_history: reviews.map((e) => ({ at: e.created_at, actor: e.actor })),
    timers: { intake_seconds: started && done ? Math.round((done - started) / 1000) : null },
  };
}

/** Report-specific range check: plain number, explicit range, identical units. Anything else is unclassified. */
export function labStatus(value?: string | null, unit?: string | null, range?: string | null): LabRow['status'] {
  if (!value || !unit || !range) return 'unclassified';
  if (!/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return 'unclassified';
  const m = range.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(.*)$/i);
  if (!m) return 'unclassified';
  const u = (x: string) => x.toLowerCase().replace(/\s+/g, '');
  if (!m[3] || u(m[3]) !== u(unit)) return 'unclassified';
  const v = Number(value), lo = Number(m[1]), hi = Number(m[2]);
  return v < lo ? 'below' : v > hi ? 'above' : 'within';
}
