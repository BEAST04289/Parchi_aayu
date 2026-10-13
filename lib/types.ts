/**
 * Shared contracts between the pipeline (A), kiosk (B) and staff (C) tracks.
 * Change only in an announced, standalone commit. Mirrors supabase/schema.sql.
 */

export type Mode = 'live' | 'replay' | 'manual';
/**
 * Extraction check state. 'source_matched' means the OCR and vision cross-check agreed and the
 * quote was found on the page. It is NOT clinical verification. Nurse states mean a human checked
 * the reading against the source; they are not clinical approval either.
 */
export type CheckState = 'source_matched' | 'pending_check' | 'nurse_confirmed' | 'nurse_corrected' | 'unreadable';
export type EvidenceKind = 'box' | 'page' | 'clip' | 'text';
export type SectionKey = 'attention' | 'reason' | 'medicines' | 'labs' | 'timeline' | 'open';
export const SECTION_KEYS: SectionKey[] = ['attention', 'reason', 'medicines', 'labs', 'timeline', 'open'];
export type CandidateId = 'onset_missing' | 'medicine_old_or_new' | 'medicine_unknown' | 'page_identity' | 'patient_concern';
export type StaffRole = 'nurse' | 'doctor';

export interface DocDate { raw: string | null; iso: string | null; precision: 'day' | 'month' | 'year' | 'unknown'; assumed_dmy?: boolean }
/** Box is normalized 0..1 [left, top, right, bottom]. start/end are char offsets into OcrPage.text. */
/** level 'line': this entry is a whole OCR line (the engine gave no alignable word boxes); its box is line-precise, not word-precise. */
export interface OcrWord { i: number; text: string; conf: number; box: [number, number, number, number]; start: number; end: number; level?: 'word' | 'line' }
/** granularity 'line': each OcrWord is a whole OCR text line with its real line box (PaddleOCR). */
export interface OcrPage { text: string; words: OcrWord[]; width: number | null; height: number | null; granularity?: 'word' | 'line' }

/** What actually ran for one processing step. Recorded on every source. */
export interface ProviderStep { provider: string; model: string; mode: 'local' | 'cloud' | 'replay'; ms: number; inference_ms?: number; cold?: boolean; error?: string }
export interface ProviderInfo { ocr?: ProviderStep; extract?: ProviderStep; extract_fallback_from?: ProviderStep; asr?: ProviderStep; translate?: ProviderStep }

export interface Encounter {
  id: string; token: string; alias: string;
  patient_name: string; patient_age: number | null; patient_ref: string | null;
  language: 'hi' | 'en'; voice_consent: boolean | null; mode: Mode;
  status: 'intake' | 'paused_urgent' | 'ready';
  intake_started_at: string | null; intake_completed_at: string | null; created_at: string;
}

export interface Source {
  id: string; encounter_id: string; kind: 'page' | 'clip' | 'typed'; seq: number; label: string;
  blob_id: string | null; mime: string | null; sha256: string | null;
  status: 'uploaded' | 'processing' | 'done' | 'failed'; processing_started_at: string | null; error: string | null;
  readability: 'unknown' | 'readable' | 'partial' | 'unreadable';
  identity: 'unchecked' | 'matched' | 'mismatch' | 'confirmed_patient' | 'withheld';
  mode: Mode; model: string | null; provider_info: ProviderInfo | null; timings: Record<string, number> | null; ocr: OcrPage | null;
  doc_type: 'prescription' | 'lab_report' | 'history_note' | 'other' | null; clinic: string | null;
  doc_date: DocDate | null; name_on_doc: string | null; age_on_doc: string | null; id_on_doc: string | null;
  width: number | null; height: number | null;
  question_id: string | null;
  /** The patient's typed words, verbatim (kind 'typed'). */
  typed_text: string | null;
  transcript_hi: string | null; transcript_en: string | null; translation_by: 'sarvam' | 'claude' | 'whisper' | null;
  duration_ms: number | null; supersedes_id: string | null; created_at: string;
}

export type FactKind =
  | 'visit_reason' | 'complaint' | 'onset' | 'duration' | 'patient_concern'
  | 'med_name' | 'med_strength' | 'med_frequency' | 'med_form' | 'med_duration' | 'med_reported_taking'
  | 'allergy' | 'allergy_reaction'
  | 'lab_name' | 'lab_value' | 'lab_unit' | 'lab_range' | 'urgent_mention';

export interface Fact {
  id: string; encounter_id: string; source_id: string; group_key: string | null; kind: FactKind;
  value: string; value_en: string | null; quote: string | null;
  anchor: { boxes: [number, number, number, number][]; precision?: 'word' | 'line' } | null; evidence: EvidenceKind;
  check_state: CheckState; reasons: string[];
  subject: 'patient' | 'other_person' | 'unknown'; assertion: 'present' | 'denied' | 'uncertain';
  temporality: 'current' | 'historical' | 'unknown';
  supersedes_id: string | null; superseded_by: string | null; created_by: string; created_at: string;
}

export interface Question {
  id: string; encounter_id: string; candidate_id: CandidateId; reason: string; fact_ids: string[];
  state: 'asked' | 'answered' | 'unknown' | 'skipped'; answer_source_id: string | null;
  picked_by: 'claude' | 'priority'; created_at: string;
}

export interface AppEvent {
  id: string; encounter_id: string; actor: string; role: 'nurse' | 'doctor' | 'patient' | 'system';
  type: string; payload: Record<string, unknown>; created_at: string;
}

/** requested -> delivered (a staff client received it) -> acknowledged (a staff member clicked) -> resumed. */
export interface Alert {
  id: string; encounter_id: string; trigger: 'manual' | 'words'; quote: string | null; source_id: string | null;
  requested_at: string; delivered_at: string | null; acked_at: string | null; acked_by: string | null;
  resumed_at: string | null; resumed_by: string | null;
}
export interface StaffAlert extends Alert { alias: string; patient_name: string }

export interface Issue {
  id: string; rule_id: string; level: 'urgent' | 'allergy' | 'review' | 'info'; section: SectionKey;
  title: string; detail: string; fact_ids: string[]; refs: SourceRef[];
  /** Weakest check state of the supporting facts: a safety concern built on a pending reading says so. */
  check?: CheckState | 'mixed';
}
export interface SourceRef { source_id: string; label: string; fact_ids: string[] }

/** One clinical field with its own evidence action. */
export interface FieldRef {
  fact_id: string; kind: FactKind; value: string; display: string; check: CheckState;
  reasons: string[]; source_id: string; source_label: string;
}

export interface BriefLine {
  id: string; text: string; text_hi?: string; text_en_by?: 'sarvam' | 'claude' | 'whisper' | null;
  refs: SourceRef[]; fields?: FieldRef[];
  /** 'verbatim' = the patient's own words shown as entered, not an interpretation. */
  check: CheckState | 'mixed' | 'verbatim';
  origin: 'documented' | 'patient_reported' | 'staff' | 'rule';
}

export interface MedEntry { group_key: string; date_iso: string | null; date_label: string | null; source_id: string; source_label: string; fields: FieldRef[] }
export interface MedRow { key: string; name: string; documented: MedEntry[]; patient_reports: FieldRef[]; flags: Issue[] }
export interface LabRow {
  key: string; name: FieldRef | null; value: FieldRef | null; unit: FieldRef | null; range: FieldRef | null;
  status: 'below' | 'within' | 'above' | 'unclassified'; date_label: string | null; source_id: string; source_label: string;
}
export interface TimelineEvent { date_iso: string | null; date_label: string; title: string; refs: SourceRef[] }

/**
 * Citation coverage only. "with_source_link" counts displayed lines that link to a stored source;
 * it does not prove that each interpretation is correct.
 */
export interface Ledger { lines: number; with_source_link: number; without_source_link: number; pending_check: number; human_checked: number; held_back: number }

export interface PageSummary {
  id: string; label: string; kind: Source['kind']; status: Source['status']; error: string | null;
  readability: Source['readability']; identity: Source['identity']; mode: Mode;
  doc_type: Source['doc_type']; clinic: string | null; date_label: string | null; seq: number;
}

export interface SectionState { hash: string; reviewed_hash: string | null; reviewed_at: string | null; reviewed_by: string | null; stale: boolean; never_reviewed: boolean }

export interface Brief {
  encounter: Encounter;
  /** sha1 over the clinical section hashes only (no timestamps, timers, alert or page status). */
  revision: string;
  /** sha1 over page/alert status, for live metadata refresh. Never drives the change banner. */
  live_hash: string;
  generated_at: string;
  coverage: { pages: number; read: number; processing: number; failed: number; withheld: number; answers: number };
  pages: PageSummary[];
  attention: Issue[]; reason: BriefLine[]; medicines: MedRow[]; labs: LabRow[];
  timeline: TimelineEvent[]; undated: TimelineEvent[]; open: BriefLine[];
  ledger: Ledger;
  sections: Record<SectionKey, SectionState>;
  alerts: Alert[];
  review_history: { at: string; actor: string }[];
  timers: { intake_seconds: number | null };
}

export interface RevInfo { revision: string; live_hash: string; section_hashes: Record<SectionKey, string> }
