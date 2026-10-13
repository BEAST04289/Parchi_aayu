# Product contract

## Primary outcome

Before the consultation, Parchi gives the doctor an inspectable summary of what the patient reports and what their documents contain. The 60-second target applies to reading the concise brief. Processing latency, patient completion time and clinical accuracy are measured separately.

The supplied final deck is the product baseline: Hindi/Hinglish intake, adaptive questions, OCR and lab extraction, prescribed versus reported use, voice playback, nurse review, evidence links, urgent interruption and version awareness. The original T01 dated timeline remains mandatory even though it is less prominent in the deck.

## Two screens

**Patient screen:** language/consent, reason for visit, document capture, up to three relevant clarifications, read-back and handoff. It works at tablet and phone sizes. Voice is optional; typed input must complete the same workflow.

**Staff screen:** a small encounter list and a fixed clinician brief. A nurse mode exposes the uncertainty queue inside this workspace. A right-side drawer opens the document or audio for a selected fact. Roles control actions; a cosmetic toggle does not grant permissions.

## Required feature contract

| Feature | Working means | Visible proof |
| --- | --- | --- |
| Voice or text intake | Record/upload/transcribe a real answer; preserve the original clip and transcript; allow correction and uncertainty | Speak an unscripted short Hindi answer; hear that recording on the staff device |
| Document capture | Accept photos and a bounded multipage PDF; show per-page reading status and retake/retry | An unreadable page stays visible as unresolved |
| OCR and structured extraction | Run OCR and one vision extraction pass; persist field-level sources, units and dates; schema-validate output | A new uploaded document changes the brief through a real processing run |
| Adaptive questions | Choose from unresolved, source-grounded question candidates; suppress already answered/skipped topics; maximum three nonurgent clarifications | A missing onset produces an onset question; the same case with known onset does not |
| Dated timeline | Separate document/event dates from upload time; sort comparable dates and group unknown dates | Three clinics and two lab reports can be opened by dated event |
| Medicines | Separate historical prescription, latest documented prescription and patient-reported use; do not label a prescription current merely because it is newest | The doctor sees two attributed accounts, not an automatically corrected regimen |
| Gaps/contradictions/concerns | Rules emit typed issues with supporting fact IDs and a plain reason | Unknown medicine, dose disagreement and buried allergy are visible with sources |
| One-screen brief | Summary stays concise and stable at the baseline staff viewport; details open progressively | Doctor can identify complaint, allergy, medicine question and important lab result without navigating multiple pages |
| Evidence drawer | Open the actual source page, valid OCR region or full audio answer; show raw quote and interpretation together | Click a field and inspect its evidence in one action |
| Nurse review | Confirm reading, correct reading, or mark unreadable; preserve actor/time and old value | Correction persists and reaches the doctor's new-version banner |
| Review state | Source review and clinical review tracked independently; compare section revisions | New allergy evidence makes the allergies section need re-review without deleting prior review history |
| Urgent interruption | Pause intake; create a staff alert; show honest delivery/acknowledgement states; manual help always available | Separate patient says a current urgent complaint; staff receives and acknowledges it |

## Priorities within eight hours

1. Establish a persisted text → fact → brief → source path across two browser contexts.
2. Make document ingestion, date handling and source navigation work live.
3. Add Hindi speech, original playback and one adaptive clarification.
4. Add uncertain-source review, version changes, urgent handoff and failure handling.
5. Polish the two screens and rehearse. Print/export is optional after these gates.

The maximum intake size for the initial build is six pages, one short clip per question, and three follow-up questions. These are implementation limits displayed before upload, not claims that the system handles every report.

## What makes it distinguishable

The demonstration should make five behaviors visible: the patient corrects the AI, a question follows a gap in the papers, a doctor sees the original evidence, a nurse resolves an uncertain reading, and new evidence changes review status without silently rewriting the brief. General-purpose models can summarize documents and understand speech. Parchi's proposed advantage is this integrated, observable workflow and its enforcement of attribution and review. Do not describe capabilities of other products without testing them.

## Rules for the brief

- Chief complaint and patient's concern in two short lines. Clearly label source and whether onset is unknown.
- Concerns at the top: recorded allergy and other clinician-review items, with uncertainty when relevant. "Not mentioned in readable documents" never becomes "No allergies."
- Medicines: a compact table showing documented prescription and patient report separately. A white tablet remains unidentified until appropriate packaging or a human establishes identity.
- Labs: a maximum of three salient results in the summary, with value, unit, date and the report's own reference interval. Additional results remain in the evidence view. Only deterministic comparisons decide within/outside range; incompatible or unreadable ranges stay unclassified.
- Timeline: the last four distinct dated events plus an explicit undated bucket and a way to view the remaining events. Do not merge different patients or silently reorder uncertain dates.
- Open issues: missing onset, unreadable dose, uncertain identity or conflicting accounts. Each asks a human to clarify rather than recommending an answer.
- Coverage: page counts by actual processing/readability/identity state. A processing failure is not an unreadable document; a withheld page is not part of the clinical summary.

## Remove from the demo scope

ABHA/EHR integration, appointment scheduling, T05 queue prioritization, medicine-price comparison, pill recognition by appearance, diagnostic chat, full interaction checking, vector search, autonomous agents and a second speech provider. The deck's ABHA observation does not establish an integration. A broad medical dictionary is not needed for this narrow demo.

## Correctness boundaries

An anchored phrase may still be wrongly interpreted. Preserve negation, temporality, subject, units and field boundaries. Do not calculate a clinical confidence percentage by averaging OCR scores and model agreement. Keep component signals and explicit reasons for review. Use exact anchors where valid; use page-level evidence labelled as such where coordinates are unavailable, then require review for uncertain critical fields.

The urgent path is a staff-assistance workflow supported by narrow demo triggers. It is not a triage classifier and must never declare a patient safe to wait. Staff determine clinical urgency. Do not ask a patient with an active urgent complaint to finish scanning paperwork.
