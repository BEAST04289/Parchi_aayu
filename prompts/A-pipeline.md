> **Status (13 Oct ~11:30):** A1 is implemented except live runs: `lib/pipeline/{ocr,extract,page}.ts`, `lib/verify/*`, upload/retry/evidence/file routes, `buildBrief` (medicines, labs with report-range status, timeline, allergy + class exposure, strength change, identity, pending/failed lines). Not run: any real Vision/Claude call (no keys). Next for A: add keys, run the A1 gate live on page-03 and a handwritten photo, record timings; then A2 rules (`med.reported_differs`, `med.unidentified`, `complaint.onset_missing`, eligibility) and A3 eval. Wherever this file says "verified", read `source_matched`; wherever it says signed URL, read `/api/sources/[id]/file`.

# A: Pipeline, rules, evidence, eval

You own:

- `lib/pipeline/*`, `lib/verify/*`, `lib/rules/*`, `lib/brief/*`, `lib/questions/eligible.ts`
- `app/api/kiosk/[token]/pages/*`, `app/api/sources/*`, `app/api/encounters/[id]/brief`, `app/api/encounters/[id]/rev`
- `scripts/eval.ts`, `scripts/smoke-claude.ts`

Pull before every prompt. Commit after every gate.

## A1 (H+0:45 → H+2:30): live page pipeline + real brief

```text
Read CLAUDE.md, PLAN.md §3, prompts/extraction-system.md, lib/types.ts and supabase/schema.sql. Implement the LIVE document path end to end. Verify the installed @anthropic-ai/sdk exposes client.messages.parse and zodOutputFormat from '@anthropic-ai/sdk/helpers/zod' before writing the adapter.

1. POST /api/kiosk/[token]/pages (multipart field "image"; JPEG/PNG/WEBP; reject > 4.5 MB with a clear message). Compute sha256; if a source with the same (encounter, sha256) exists, return it (no reprocessing, no duplicate facts). Store to Storage at sources/{encounter_id}/{source_id}.jpg. Insert a sources row (kind page, next seq, label p{seq}, status uploaded, mode = encounter.mode). Respond with the row, then run processPage(source_id) via after() (if after() is unsupported, expose POST /api/kiosk/[token]/pages/[id]/process and have the kiosk call it). Also add POST /api/kiosk/[token]/pages/[id]/retry for failed pages. Routes processing pages: export const maxDuration = 60. Queue: at most 2 pages per encounter in 'processing' at once (claim with a conditional update; if 2 are already processing leave the page 'uploaded'); when processPage finishes (success or failure) it starts the oldest 'uploaded' page of that encounter. On a final 429 after the SDK's retries, mark failed "Rate limited — retry".

2. processPage (lib/pipeline/page.ts), with status 'processing' then 'done' or 'failed'; record per-stage ms in timings:
   a. OCR (lib/pipeline/ocr.ts): Google Vision images:annotate DOCUMENT_TEXT_DETECTION via REST with GOOGLE_VISION_API_KEY (fallback: service account from GOOGLE_CREDENTIALS_JSON). Convert fullTextAnnotation into OcrPage: words in reading order with text, confidence, and boxes normalized to 0..1 using the page width/height from the response. Keep line breaks in OcrPage.text, and keep a char-offset → word index map so a quote can be mapped back to words.
   b. Extraction (lib/pipeline/extract.ts): one Claude call with the image (base64) + the OCR text + the encounter's patient name/age/ref. System prompt = prompts/extraction-system.md (page section). Zod schema per that file. Model = PARCHI_MODEL, output_config.effort = PARCHI_EFFORT. stop_reason refusal/max_tokens or null parsed_output → throw a typed error (page becomes failed with a readable message).
   c. Verifier (lib/verify/page.ts), pure and unit-tested, exactly as PLAN.md §3:
      normalize = lowercase; delete Unicode \p{P} and \p{S} EXCEPT a '.' between two digits ("12.5" must stay "12.5", never "125"); keep letters, combining marks (Devanagari matras) and digits; tokenize on whitespace AND at digit↔letter boundaries ("50mg" → "50","mg"). Never fuzzy-match.
      ocr_quote null, or its tokens not found as a contiguous run in the normalized OCR tokens → check_state pending_check, evidence 'page', reason 'AI read this from the image; OCR could not confirm it'.
      Found → map to OCR words → union box → anchor.boxes; evidence 'box'. Agreement for EVERY kind: each normalized token of value must appear as a whole token in the normalized quote (12.5≠125, 25≠250, BD≠8D); else pending_check with reason `OCR reads '<quote>', AI reads '<value>'`. Any matched word conf < 0.80 → pending_check, reason 'Low OCR confidence'. med_name not in data/drugs.json (name or alias) → pending_check 'Not in drug list'. med_strength not in that drug's strengths → pending_check 'Unusual strength for this drug'. Otherwise verified. Never rewrite value from the dictionary.
      Drop (count as held_back, never show): items with no value, invalid kinds, or subject other_person (store nothing for them in the patient's facts; log the count on the source timings as held_back).
   d. Source metadata: doc_type, clinic, doc_date {raw, iso, precision, assumed_dmy}, name_on_doc, readability. Identity (lenient by design; it must never withhold the demo's own pages): parse age from "52", "52 M", "52 years", "52y". matched = ref matches, OR first names close (edit distance ≤ 2 or one is a prefix of the other) with age within ±1 when both present. mismatch (set identity 'withheld') ONLY when a name is present and clearly different (edit distance > 2 and not a prefix). No name → unchecked (not withheld).
   e. Insert all facts in one batch at the end. On any thrown error: status failed, error message, zero facts.
   f. REPLAY: if encounter.mode = 'replay', look up replays by sha256 and reuse its stored {ocr, extraction} through the same verifier (mode 'replay'); unknown hash → failed "No recorded result for this exact file (replay mode)". In live mode, after success, upsert the replays row automatically.

3. GET /api/sources/[id]/evidence (staff): {kind, label, signed_url (300 s), width, height, mime, ocr words only if needed, transcript_hi, transcript_en, translation_by, supersedes chain for clips}.

4. buildBrief (lib/brief/build.ts), a pure function over current facts (superseded_by is null), sources, questions, events and alerts that returns the Brief type. Exclude facts from withheld sources. Medicines grouped by normalized med_name (fact group_key ties name/strength/frequency of one line); documented entries ordered by source doc_date with a date label like "04 Sep"; text e.g. "50 mg · BD (twice daily)" (BD/TDS/OD expansion only, no food timing); patient_reports from med_reported_taking facts. Labs: name, value, unit, range; status computed in A2 (unclassified for now). Timeline: one event per page source with doc_date (sorted), undated bucket separately; title = doc_type + clinic. Reason: visit_reason/complaint/onset/duration/patient_concern lines with text_hi quotes. Ledger: count lines and refs; unsupported = lines without any ref (must be 0). Section hashes: sha1 of each section's rendered JSON. revision = sha1 of the whole Brief JSON excluding generated_at (so failed pages, alert delivery, mode switches and identity releases all move it); counter = number of facts + events. Reviewed/stale from the latest doctor_review event's stored hashes. Ensure GET /api/encounters/[id]/rev returns {revision, counter} computed from the real buildBrief() (fine at demo scale).

Gate (record actual results in docs/HANDOFF.md): upload fixtures/page-03.png with curl → in under ~25 s the brief API shows Metoprolol 50 mg BD as three source_matched facts with boxes; evidence API returns a signed URL that loads. Upload the SAME file again → no new facts. Upload the handwritten p1 photo → print each fact's value, check_state and reasons, plus per-stage timings at effort low and medium (pick one and set PARCHI_EFFORT). Break the Vision key → page failed with a readable error and zero facts. Write unit tests for the verifier: 12.5 vs 125, 25 vs 250 and BD vs 8D → pending; "50mg" vs "50 mg" and punctuation-only differences → agree; missing quote → pending; Devanagari quote with matras found in a transcript → found.
```

## A2 (H+2:30 → H+4:30): rules engine, eligibility, identity, ledger

```text
Implement lib/rules/*.ts as pure functions returning Issue[] (PLAN.md §3 rules table), using data/allergy-classes.json and data/drugs.json. Version each rule (rule_id like 'allergy.class_exposure@1'). Wording is always a question for the clinician, never advice.
- allergy.recorded: patient allergy facts (assertion present) → attention level 'allergy' ("Penicillin allergy recorded · Clinic A · 14 Aug"); allergy_reaction missing → detail "Reaction not recorded". Denied allergy ("No known penicillin allergy") → shown as a documented negative line in open/attention info, never as an allergy and never as "no allergies" overall.
- allergy.class_exposure: any med_name fact in the same class as a recorded allergy → attention level 'allergy': "Amoxicillin (a penicillin) prescribed 10 Sep · Clinic C. Penicillin allergy recorded. For clinician review; current use unknown." Refs to both sources.
- med.strength_changed: same normalized drug, different strengths across documents → MedRow flag "Documented strength changed: 25 mg (14 Aug) → 50 mg (04 Sep)".
- med.reported_differs: med_reported_taking with a strength that differs from the latest documented strength → flag "Patient reports 25 mg; latest prescription 50 mg".
- med.unidentified: patient mentions an unnamed tablet (e.g. 'सफेद गोली') with no supported identity → open line "Unidentified tablet reported; ask for strip/box".
- complaint.onset_missing: a SYMPTOM complaint (kind 'complaint'; a 'visit_reason' like showing old papers does not count) exists with no onset/duration fact → open line.
- lab.range: numeric value + explicit report range in the same unit → below/within/above; anything else unclassified. Comparators like '<5' → unclassified.
- doc.identity_mismatch: withheld page → attention level 'review' "p7 names Sita, 34 — withheld pending identity check".
- doc.date_missing / assumed_dmy → timeline label "date unclear" or "assumed DD/MM".
- pending checks / failed pages → open lines with counts ("2 readings pending source check", "1 page could not be processed — retry").

Implement lib/questions/eligible.ts: eligibleQuestions(facts, sources, questions, issues) → CandidateId[] in priority order [onset_missing, medicine_old_or_new (only when med.strength_changed exists or documents disagree), medicine_unknown, page_identity, patient_concern], excluding candidates already asked/answered/unknown/skipped and returning [] after 3 asked. Export the supporting fact IDs and a plain reason for each (B's picker uses them).

Wire issues into buildBrief (attention, medicine flags, lab status, open). Add vitest tests from fixtures/cases.json: C01 negation, C02 other person, C04 white tablet, C05 BD only, C07 missing range, C08 unknown reaction, C10 date fragment vs dose, C11 other patient withheld, C13 new allergy after review → stale + old review kept, C18 25 vs 250.

Gate: in a fresh encounter, upload typeset pages 1,2,3,5,6 → brief shows strength change 25→50, Hb below range, creatinine within, timeline 14 Aug, 02 Sep, 04 Sep, 10 Sep, 12 Sep, no allergy. Record a doctor_review event, then upload page 4 → attention shows the penicillin allergy and the amoxicillin class-exposure line; the attention section is stale while unrelated sections stay reviewed; ledger unsupported = 0. Repeat with the handwritten pages and record the differences in HANDOFF.md.
```

## A3 (H+4:30 → H+6:00): measurement + replay recordings

```text
1. scripts/eval.ts (tsx): for every image in fixtures/handwritten/ with labels in fixtures/gold-handwritten.json (C writes these BEFORE looking at outputs), run OCR → extract → verify in-process (not via HTTP). Compare per gold field using exact normalized value match. Print and write docs/EVAL.md: per field type (med_name, med_strength, med_frequency, allergy, lab_value, doc_date) the counts of correct+verified, correct-but-pending (sent to nurse), wrong-but-pending (caught), WRONG-AND-VERIFIED (dangerous — list each), missed; plus per-page latency median and range; model, effort, N pages, date. Never print a percentage without its denominator. Optionally rerun with PARCHI_MODEL=claude-haiku-5-5 and add a second table plus token/cost estimate from response.usage.
2. Run the main demo once in LIVE mode with the exact gallery photos so the replays table holds their results; verify REPLAY mode by switching the encounter mode and re-uploading the same files (results load, badge shows REPLAY), and that a new unseen photo fails honestly.
3. Warm-up: a GET /api/warmup (staff) that runs one tiny extraction per zod schema so the first live call on stage doesn't pay schema compilation.
Gate: docs/EVAL.md exists with real numbers; replay verified; HANDOFF.md updated.
```
