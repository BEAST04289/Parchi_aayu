// SUPERSEDED for the build: lib/types.ts (created by prompts/00-scaffold.md) is the contract. Kept for reference only.

/** Starting domain contracts. No API, persistence, validation or clinical engine is implemented here. */
export type Id = string;
export type Mode = 'live' | 'fixture_replay' | 'manual';
export type Section = 'complaint' | 'allergies' | 'medicines' | 'labs' | 'timeline' | 'issues';
export type SourceKind = 'document_page' | 'audio_answer' | 'typed_answer' | 'staff_entry';
export type ProcessingState = 'received' | 'queued' | 'processing' | 'succeeded' | 'failed';
export type Readability = 'not_assessed' | 'readable' | 'partial' | 'unreadable';
export type IdentityState = 'unchecked' | 'matched' | 'needs_review' | 'withheld';
export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

export interface SourceDate {
  raw: string | null;
  iso: string | null;
  precision: DatePrecision;
  interpretation: 'explicit' | 'ambiguous' | 'missing';
}

export interface Source {
  id: Id;
  encounterId: Id;
  kind: SourceKind;
  version: number;
  sha256: string;
  storageKey: string | null; // Private key, never a permanent public URL.
  originalText: string | null;
  originalFileId: Id | null;
  originalPageNumber: number | null;
  eventDate: SourceDate;
  uploadedAt: string;
  processing: ProcessingState;
  readability: Readability;
  identity: IdentityState;
  dimensions: { width: number; height: number; rotation: 0 | 90 | 180 | 270 } | null;
  durationMs: number | null;
}

export type Anchor =
  | { kind: 'ocr_words'; wordIds: string[]; boxes: [number, number, number, number][] }
  | { kind: 'text_span'; start: number; end: number }
  | { kind: 'audio_segment'; startMs: number; endMs: number }
  | { kind: 'page_only' }
  | { kind: 'whole_clip' };
// Boxes use [left, top, right, bottom], normalized to [0,1] in the canonical source image.
// Text span offsets refer to the exact stored transcript/OCR version, not a translated paraphrase.

export interface Evidence {
  sourceId: Id;
  sourceVersion: number;
  quote: string;
  anchor: Anchor;
  match: 'exact' | 'normalized' | 'unmatched' | 'human_selected';
}

export type FactKind =
  | 'complaint' | 'onset' | 'duration' | 'severity' | 'patient_concern'
  | 'medicine_name' | 'medicine_strength' | 'medicine_dose' | 'medicine_frequency'
  | 'medicine_form' | 'medicine_use_status' | 'medicine_barrier'
  | 'allergy_substance' | 'allergy_reaction'
  | 'lab_name' | 'lab_value' | 'lab_unit' | 'lab_reference_range' | 'event_date';

export interface FactRevision {
  id: Id;
  logicalFactId: Id;
  groupId: Id | null; // Groups medicine/lab fields without sharing guessed evidence.
  revision: number;
  supersedesId: Id | null;
  encounterId: Id;
  kind: FactKind;
  rawValue: string;
  normalizedValue: string | null;
  origin: 'document' | 'patient_said' | 'patient_typed' | 'staff_entered';
  subject: 'patient' | 'other_person' | 'unknown';
  assertion: 'present' | 'denied' | 'uncertain';
  temporality: 'current_report' | 'historical_document' | 'unknown';
  eventDate: SourceDate;
  evidence: Evidence[];
  extractionReview: 'unchecked' | 'needs_check' | 'source_checked' | 'corrected' | 'unreadable';
  reviewReasons: string[];
  signals: {
    ocrWordConfidence: number[] | null;
    dictionaryCandidate: string | null;
    dictionaryMatch: 'exact' | 'candidate' | 'none' | 'not_applicable';
    semanticChecks: ('negation' | 'subject' | 'numeric_value' | 'unit' | 'temporality')[];
  };
  createdAt: string;
  createdBy: Id | 'system';
  processingRunId: Id | null;
}

export interface Issue {
  id: Id;
  encounterId: Id;
  category: 'urgent_assistance' | 'clinical_review' | 'contradiction' | 'data_gap' | 'source_quality' | 'identity';
  ruleId: string;
  ruleVersion: string;
  section: Section;
  message: string;
  supportingFactIds: Id[];
  supportingSourceIds: Id[];
  state: 'open' | 'acknowledged' | 'clinician_resolved' | 'superseded';
  resolution: { actorId: Id; at: string; note: string } | null;
}

export interface Question {
  id: Id;
  encounterId: Id;
  candidateId: string;
  templateVersion: string;
  issueIds: Id[];
  textHi: string;
  textEn: string;
  state: 'eligible' | 'asked' | 'answered' | 'skipped' | 'patient_unsure' | 'superseded';
  answerSourceId: Id | null;
}

export interface BriefLine {
  text: string;
  factIds: Id[];
  issueIds: Id[];
  sourceIds: Id[];
  label: 'documented' | 'patient_reported' | 'staff_entered' | 'unresolved';
}

export interface BriefSnapshot {
  id: Id;
  encounterId: Id;
  encounterRevision: number;
  sectionRevisions: Record<Section, number>;
  sections: Record<Section, BriefLine[]>;
  sourceIds: Id[];
  createdAt: string;
}

export interface ReviewEvent {
  id: Id;
  actorId: Id;
  actorRole: 'nurse' | 'doctor';
  target: { kind: 'fact'; factRevisionId: Id } | { kind: 'section'; section: Section; sectionRevision: number } | { kind: 'issue'; issueId: Id };
  action: 'confirm_source' | 'correct_source' | 'mark_unreadable' | 'review_section' | 'resolve_issue';
  note: string | null;
  at: string;
}

export interface StaffAlert {
  id: Id;
  encounterId: Id;
  issueId: Id;
  requestedAt: string;
  deliveredAt: string | null; // Actual staff-client receipt; persistence alone is not delivery.
  acknowledgedAt: string | null;
  acknowledgedBy: Id | null;
  deliveryFailure: string | null;
  resumedByStaffAt: string | null;
}

export interface ProcessingRun {
  id: Id;
  sourceId: Id;
  sourceHash: string;
  mode: Mode;
  provider: string;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  state: ProcessingState;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
}
