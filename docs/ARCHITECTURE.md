> **Build-day note:** `PLAN.md` overrides this file wherever they conflict (simplified architecture, 6 tables, polling, no pairing codes/RLS/snapshot tables/PDF). Use `prompts/00-scaffold.md` then `prompts/A|B|C-*.md`; the old numbered prompts are in `prompts/superseded/`.

# Architecture and data boundaries

## Small, explicit stack

One Next.js/TypeScript app serves the patient and staff routes. Use Tailwind and accessible primitives for the interface, React state for local interaction, and Supabase Postgres/Storage for shared persistence. Use Supabase Realtime for staff invalidation, with a short polling fallback for the selected encounter. Database state is authoritative; websocket messages are not the only copy of an event.

Speech: Sarvam `saaras:v4`, one short recording per answer. OCR: Google Cloud Vision document text detection. Structured extraction: one vision-capable model via a server-only adapter and validated JSON. A configurable model ID lets the team test latency and field accuracy before pinning the app's runtime model. Claude Code's selected model does not configure the app automatically.

No vector database, RAG framework, orchestration agents or microservices are needed for a six-page encounter. Browser PDF rendering plus bounded page rasterization is sufficient; retain the original PDF and page mapping. Validate actual SDK versions and MIME support during implementation.

## Data flow

1. Staff creates an encounter and a short-lived pairing code. Patient exchanges it for a scoped secure session. Staff authenticates with a seeded account; no registration product is needed.
2. The patient submits voice/text and documents independently. Text produces a versioned source directly. Each accepted document page gets immutable bytes, a hash, page dimensions and an actual job state.
3. A page job obtains OCR words/boxes. The vision model sees that page and OCR text, and returns candidate facts with field-specific evidence. Do not merge patients before an identity check.
4. The validator checks schema, source identity, quote offsets, word IDs, box bounds, number/unit consistency, negation and date precision. Uncertain candidates create review items. Quote matching alone is not semantic validation.
5. Deterministic rules consume active attributed facts and issue records. The brief is assembled from those facts using templates or constrained paraphrases that retain fact IDs. Avoid a second unconstrained summarizer that can add uncited sentences.
6. Candidate questions derive from unanswered issues. The model chooses a candidate ID; code validates eligibility and supplies the reviewed bilingual question template. Answers enter the same source/fact flow.
7. Nurse corrections create new revisions and an audit event. A transactional mutation increments the encounter revision and affected section revisions. Staff sees invalidation and fetches the latest state.
8. Opening a brief creates a stable snapshot; a newer critical concern also reaches an immediate alert strip. Review events attach to exact section revisions.

## Evidence model

Use atomic facts or a field-level evidence map. The included `contracts/domain.ts` chooses atomic fields linked by a `groupId`, so a medicine name, strength, dose, frequency and status can have different uncertainty states. Do not attach one vague quote to an entire medicine object.

Store original text and normalized display text separately. A source has a hash and revision. An anchor refers to that exact revision. Reprocessing OCR does not silently move existing anchors. Coordinates use normalized page/image space with width/height and rotation accounted for. Audio anchors refer to real segment ranges if returned; otherwise the full answer clip is the evidence.

Keep three independent concepts:

- Source quality: readability and processing state.
- Extraction review: unchecked, needs check, source checked, corrected or unreadable.
- Clinical review: not reviewed, reviewed on a particular revision, or clinician-resolved issue.

A patient-confirmed transcript is still a patient report. A source-checked prescription is still a prescription, not proof of actual medicine use. Unknown subject or identity means withhold from the clinical brief until reviewed.

## Persistence

| Table | Main content |
| --- | --- |
| `encounters` | alias, patient identity as provided, revision, selected language, intake state |
| `staff_memberships` | authenticated actor, role, clinic scope |
| `pairing_sessions` | hashed one-use pairing code, encounter scope, expiry; server-mediated access |
| `sources` | immutable page/audio/text bytes or storage key, hash, source version, original file/page index, OCR/transcript and coverage state |
| `processing_runs` | provider/model, input hashes, LIVE/REPLAY mode, stage, timings, failure and prompt/schema version |
| `fact_revisions` | atomic field/value, source evidence, patient/other/unknown subject, assertion, temporality, review state, superseded revision |
| `issues` | rule/version, severity category, supporting facts, review status and resolution |
| `questions` | candidate/template ID, originating issues, asked/answered/skipped and answer source |
| `brief_snapshots` | encounter revision, section revisions and rendered fact IDs |
| `review_events` | section/issue, exact revision, actor, action, reason and time |
| `staff_alerts` | requested, delivered-to-client, acknowledged, failed; each timestamp separately |
| `audit_events` | append-only mutation record including old/new revision links |

The table count does not require eleven complex UI modules. Keep all mutations in a small server service and make event updates transactional. Use an expected revision to reject a stale write with a conflict, rather than overwriting a newer correction.

## Access and storage

Use private storage, short-lived authorized source access and row-level security on exposed tables. Staff policies restrict encounters to their clinic scope. The patient session may submit or edit its own intake but cannot list encounters, read other patients, write staff reviews or acknowledge alerts. Every server route must validate that scope; the privileged database client bypasses RLS, so server authorization is still required.

Use the Supabase publishable client key only where appropriate and keep secret/service credentials on the server. Do not expose secrets with a `NEXT_PUBLIC_` prefix. Avoid putting bearer credentials in visible URLs; exchange the pairing code for a scoped cookie and invalidate the code. Kiosk reset clears local patient state. In the demo, use synthetic data and expire the sessions.

## Suggested routes

| Route/action | Behavior |
| --- | --- |
| `POST /api/encounters` | Staff creates encounter and pairing code |
| `POST /api/pair` | Exchange one-use code for patient session |
| `POST /api/encounters/:id/sources` | Validate bounded file/text upload and create source |
| `POST /api/sources/:id/process` | Process one source with idempotency key; return actual persisted state |
| `POST /api/encounters/:id/answers` | Persist answer source, extract, update eligible questions |
| `GET /api/encounters/:id/brief` | Authorized snapshot/latest metadata |
| `GET /api/sources/:id/evidence` | Authorized source metadata/short-lived asset URL |
| `POST /api/facts/:id/reviews` | Staff source review with expected revision |
| `POST /api/encounters/:id/clinical-reviews` | Authorized clinician review of exact section revision |
| `POST /api/encounters/:id/alerts` | Request assistance; idempotent by active alert |
| `POST /api/alerts/:id/acknowledge` | Staff acknowledgement, not clinical completion |

Process no more than two pages concurrently initially. Await work or use a durable job mechanism supported by the selected host; do not launch unawaited background work inside a request that may be terminated. Keep per-stage failures retryable. Dedupe identical bytes within the encounter using hashes; retries must not duplicate facts or alerts. Check the deployment's actual upload and request limits before the live demo.

## Rules, carefully scoped

| Rule | Conditions and output |
| --- | --- |
| Missing onset | Symptom exists but onset/duration unresolved; eligible clarification |
| Unidentified medicine | Patient reports a white tablet without a supported identity; ask for packaging or leave unknown |
| Dose discrepancy | Compare correctly matched medicine fields and compatible units; report conflicting accounts, not which is right |
| Missing/ambiguous date | Keep raw date and precision; unknown bucket or review; never substitute upload date |
| Report-range comparison | Only numeric compatible value and explicit report interval; preserve comparator and units; otherwise unclassified |
| Recorded allergy | Surface attributed positive/uncertain allergy evidence. Distinguish absence of documentation from explicit denial |
| Allergy/medicine concern | Narrow versioned demo lookup for penicillin/amoxicillin; preserve historical/current/unknown exposure and ask a clinician to review. No blanket treatment instruction or broad beta-lactam extrapolation |
| Identity mismatch | Compare multiple available identifiers; name variation alone creates a review item, not automatic final rejection |

Drug dictionary matches are candidates. Never fuzzy-match numeric strengths or silently correct a medication to a more common name. A "valid strength" list cannot establish a safe prescribed dose: dose may depend on tablet count, formulation and patient context. For the demo, route unclear critical fields to a human instead of calculating a pseudo-probability.

## Speech details

Feature-detect `MediaRecorder` MIME support. Use WebM/Opus on a supported browser; handle other supported formats through the adapter. Use one under-30-second answer per request; cap UI recording at 25 seconds. Keep a source-language transcript as the anchor. English translation is a separate attributed representation and cannot serve as an exact quote from the audio by itself.

Sarvam documents optional phrase-level timestamps; use them only if actually returned and valid. Full-clip playback is sufficient. `language_probability` is language-detection confidence, not transcription correctness. Do not display it as certainty about a clinical fact.

## Urgent handoff

The manual help button works without AI. A small clinician-reviewed demo trigger set may request assistance for an explicitly current urgent complaint. Include negation/temporality tests and route ambiguous mentions to human assessment rather than declaring them safe. This feature is not a validated emergency screen and cannot detect all emergencies.

Separate alert creation from delivery and acknowledgement. If the network fails, the patient sees an instruction to approach nearby staff now. Acknowledgement records who saw the request, not that a clinical assessment was completed. Resuming intake requires an explicit staff action; the system never self-clears the patient.

## Runtime extraction prompt

Use `prompts/extraction-system.md`, an explicit JSON schema and a validated response parser. Model refusals, timeouts or invalid output produce a visible processing failure, not successful empty extraction. Save the model ID, schema/prompt version and input hashes. Provider output is untrusted.

## Explicit fallback modes

LIVE calls providers. FIXTURE REPLAY loads a recorded result only for the matching source hash and visibly labels it. MANUAL permits attributed human input after failure. An arbitrary unseen upload must never receive a canned fixture answer. Cache/replay is a continuity aid; it is not evidence of fresh extraction or handwriting accuracy.
