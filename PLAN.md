> **As built (13 Oct 2026, ~11:30 IST). These decisions override the text below where they differ.** Details and test evidence: `docs/HANDOFF.md`.
> - **Database:** plain SQL through `lib/db.ts`: Supabase Postgres via `DATABASE_URL` (pg, transaction pooler) or, locally only, PGlite in `.data/pglite` (header shows LOCAL DEV DATABASE). Same `supabase/schema.sql`. RLS enabled with no policies; anon/authenticated grants revoked on Supabase.
> - **Source files** are stored in a private `blobs` table and served only by `GET /api/sources/[id]/file` with a staff session. No Supabase Storage, no signed URLs.
> - **Staff session:** HMAC-signed cookie (`SESSION_SECRET`), expiry, httpOnly, SameSite=Lax. Roles chosen at login are labelled "Demo roles".
> - **Naming:** the check state is `source_matched` (not "verified"). It is an **OCR and vision cross-check**, not two independent readers: the vision model sees the OCR text. The ledger reports **citation coverage** (lines with a source link), pending checks and staff checks; it is not proof that interpretations are correct.
> - **Revisions:** section hashes cover clinical content only (no timestamps, timers, URLs, alert or page status). `live_hash` carries page/alert status and never triggers the change banner. "Mark reviewed" stores the hashes the doctor actually had on screen.
> - **Assistance:** open alerts are polled for **all** encounters on every staff screen. requested -> delivered (a staff screen received it) -> acknowledged (a person clicked) -> resumed. The patient sees "स्टाफ ने आपका अनुरोध देख लिया है / Staff acknowledged your request", never "staff are coming".
> - **Patient flow:** tell us (type; voice is B1) -> add papers (skippable) -> check -> done. Help works on every screen and before any upload.
> - **FIXTURE REPLAY:** `npm run seed:fixtures` adds hand-authored replay rows for the six typeset fixture PNGs (labelled, page-level evidence only, all pending). A LIVE run of the same file overwrites its row with real output.

# Parchi: the winning plan (Round 2, build day)

**6SYNC7 · AAYU-TARV · T01 The Two-Minute Doctor**

**This file is the scope authority.** Where it conflicts with `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE.md`, `docs/UI_SPEC.md`, `docs/BUILD_PLAN.md` or `docs/DEMO.md`, this file wins. The kit's clinical-safety rules in `CLAUDE.md` still apply in full.

---

## 0. TL;DR

**What we're building in 8 hours:** a single live story.

1. Ramesh photographs his handwritten prescriptions on a phone and speaks in Hindi.
2. Parchi asks one question that comes from a gap in his papers.
3. The doctor sees a one-screen brief on the projector. Every line opens its source, either the ink on the page or the patient's own voice clip.
4. A nurse checks the one reading the AI wasn't sure about.
5. Ramesh finds one more paper at the bottom of his folder. It records a **penicillin allergy**, and Clinic C had prescribed **amoxicillin** (a penicillin) on 10 Sep. The doctor's screen flags this immediately, for clinician review. That is the problem statement's own scene, solved live.

**What changes from the ChatGPT kit:** we keep its safety principles and cut its infrastructure.

- 12 tables → 6.
- No pairing codes, row-level security, snapshot tables or Realtime.
- The issues, the brief and review staleness are **recomputed from facts on every read**, not stored and kept in sync.
- Live updates use polling.

This turns roughly two days of infrastructure into roughly two hours. All the saved time goes to the parts judges actually see: real handwriting, a real voice, the evidence drawer, the allergy reveal, and rehearsal.

**How we win each award:**

| Award | What wins it for us |
| --- | --- |
| Best Working Prototype | The full story runs **live** on a real phone and a projector, with real handwriting from our medical teammate. We freeze features by H+5:30 and rehearse three times. A backup video and an honest replay mode cover failures. |
| Best Healthcare Experience | A Hindi-first kiosk that **speaks its questions aloud** (for patients who can't read). Read-back with correction ("मैंने यह समझा"), with "पता नहीं" and skip. A doctor brief readable in 60 seconds. |
| Best Healthcare Innovation | Prescribed vs actually taking. Questions driven by gaps in the papers. An **OCR and vision cross-check** (the vision model's reading must match the OCR text), or a nurse sees the ink. A live **verification ledger** shows how many AI readings were held back and how many are waiting for a nurse. |
| Impact (scored for all) | Real measured numbers on handwritten pages, with denominators. Starts from a QR code, mirroring ABHA Scan & Share. A cost-per-patient estimate from logs. Time saved is presented as a target, never a claim. |

---

## 1. The next 45 minutes (H+0:00 → H+0:45)

Everyone works in parallel. Nobody writes app code except the scaffold owner.

| Who | Do now | Done when |
| --- | --- | --- |
| **A (pipeline lead)** | Open Claude Code in an **empty** `C:\dev\parchi` (**not inside OneDrive**) and paste `prompts/00-scaffold.md`. It runs `create-next-app` first, then copies this kit in. Push to GitHub. Import it into Vercel (dashboard → Add New → Project), set region **bom1 (Mumbai)**, add env vars and deploy. | A deployed HTTPS URL shows the staff page and the kiosk page |
| **B (kiosk lead)** | Get the Sarvam key. Run the speech smoke tests (§9): record a 5-second Hindi clip on the demo phone and send it to `/speech-to-text`, once with `mode=transcribe` and once with `mode=translate` on `saaras:v4`. If `mode` is rejected, try `saaras:v3`. Run a TTS test with `bulbul:v3` and speaker `shubh` or `priya`. | The transcript and translation are printed, and one Hindi question plays as MP3 |
| **C (staff lead + clinical)** | Handwrite the props (§7). Create the Google Cloud Vision API key and the Supabase project (Mumbai). **Run the critical smoke test:** photograph handwritten p1 with the demo phone, send it to Vision `DOCUMENT_TEXT_DETECTION`, then to Claude, and check the quote match (§9). | We know whether OCR and Claude agree on real handwriting, and the per-page latency |

> **The handwriting smoke test is the single most important early signal.** If Vision garbles the handwriting, the design still works: Claude's reading shows in amber as "pending source check" and goes to the nurse. But we need to know by H+0:45, not H+4.

**Also check the Anthropic rate-limit tier** (Console → Settings → Limits). A brand-new org may be on the lowest tier, where several parallel image calls get HTTP 429. If so:

- add credits to move up a tier
- keep the two-pages-at-a-time queue
- test five uploads in a row at checkpoint 2

**Ask the organisers today:**

- Are pre-built accounts and keys allowed? They almost always are.
- What is the exact deadline and the format of the demo slot?
- Is there a projector, and what are the Wi-Fi details?

Keep a phone hotspot ready as a network fallback.

---

## 2. The promise checklist: deck → build

Everything we promised on the slides, where it lives, and its priority. **P0** = must work live. **P1** = should, high judge value. **P2** = stretch.

| Deck promise | Slide | Build | Pri |
| --- | --- | --- | --- |
| Speaks in Hindi / Hinglish | 2, 3 | Push-to-talk, Sarvam `saaras:v4` transcribe; Hindi plus English shown side by side | P0 |
| Photographs prescriptions and reports | 2, 4 | Camera and gallery upload, compressed on the device, per-page status | P0 |
| Guided photo with blur check | 4 | Blur score in the browser (Laplacian variance) → "retake?" hint, never a block | P1 |
| Answers 1–3 questions about gaps | 2, 3 | Questions eligible only from detected gaps; reviewed Hindi templates; AI picks among them; max 3 | P0 (≥1 question) |
| "Pata nahi" and skip always allowed | 3 | Buttons on every question; never re-asked | P0 |
| Reads back and corrects: "Maine yeh samjha…" | 2 | Transcript read-back with सही है / बदलें / फिर से बोलें; corrections keep the original | P0 |
| Nurse: low-confidence handwriting, ink beside it | 2, 4 | Nurse queue showing the cropped ink region, the AI reading and the reason | P0 |
| Nurse: "Is this report yours?" | 2, 5 | Name mismatch withholds the page and goes to the identity queue; the kiosk asks the patient | P1 |
| Confirm / correct / mark unreadable, logged with name and time | 2 | Fact revision plus an append-only event | P0 |
| Doctor: concern in patient's own words | 2 | Hindi quote, English line, ▶ plays the actual clip | P0 |
| Doctor: prescribed vs actually taking | 2, 3 | Medicines table with "Documented" and "Patient reports" columns and a difference flag | P0 |
| Doctor: open issues and allergy concerns first | 2 | Attention strip at the top | P0 |
| Tap any line → page photo or voice clip | 1, 2 | Evidence drawer with the page, a zoomable highlight box, or the audio clip | P0 |
| OCR + vision model, drug dictionary, valid strengths, OD/BD/TDS decoder | 3, 4 | Vision → Claude → verifier (dictionary and strength list are proposals only) | P0 |
| The model quotes; code checks the quote; uncited lines never reach the doctor | 3, 4 | Verifier plus the **verification ledger** on the brief | P0 |
| Urgent words stop the kiosk and call staff | 3, 5 | Fixed trigger list and a help button → staff alert with a chime → patient sees "acknowledged" only after staff click | P0 |
| No diagnosis | 3 | No diagnosis text anywhere; discrepancies are worded as questions | P0 |
| New evidence resets the doctor's review | 3 | Section content hashes; a review becomes stale when its hash changes; change banner | P0 |
| Dated timeline (T01 requirement) | PS | Event dates from documents; undated bucket; never the upload date | P0 |
| Lab values with ranges | 2 | Original value, unit and the report's own range; deterministic in/out-of-range | P0 |
| Dose-change detection; allergy-class table | 4 | Rules engine in TypeScript with no AI | P0 |
| Kiosk PWA; staff app with nurse and doctor mode | 4 | Next.js routes `/k/[token]` and `/staff` (PWA manifest is P2) | P0 |
| Wi-Fi/API failure: text fallback, cached results, backup video | 5 | Text input always visible, FIXTURE REPLAY mode, recorded video | P0 (text + video), P1 (replay) |
| Measure: fields read correctly; unsupported statements; seconds to evidence; kiosk time | 6 | `scripts/eval.ts` on the handwritten gold set, ledger, drawer timer, intake timer | P1 |
| ABHA Scan & Share-style start | 6 | QR code on the staff screen opens the kiosk | P1 |

### Upgrades beyond the deck (cheap, high judge value)

| Upgrade | Why judges care | Cost | Pri |
| --- | --- | --- | --- |
| **Kiosk speaks each question aloud** (Sarvam `bulbul:v3`, audio **pre-generated** for the fixed question bank) | Many OPD patients can't read, and the deck is otherwise text-heavy for them | ~45 min, and there's no runtime risk because the audio is pre-generated | P1 |
| **Verification ledger** under the brief: "18 lines · 18 sourced · 2 AI readings rejected · 3 checked by nurse" | Turns "every line has a source" from a claim into something visible and checkable | ~30 min | P1 (core) |
| **The amoxicillin ↔ penicillin flag** across two clinics | It is the PS's buried-allergy scene, made concrete | Part of the rules engine | P0 |
| **"Paper vs Parchi" judge challenge**: give a doctor-judge the paper folder and ask "Is he allergic to anything? Which metoprolol strength is he actually taking?", then show the brief | A visceral and honest comparison; the judges are doctors | Demo choreography only | P1 |
| **Printable one-page "parchi"** (print stylesheet plus a QR to the evidence) | Many district OPD desks have no screen. The product name *is* the slip | ~40 min | P2 |
| **Intake timer and evidence-open timer** shown in staff view | Delivers slide 6's "what we will measure" live | ~20 min | P1 |
| **Haiku 5.5 vs Opus 5.5 on the same gold set** | A cost-per-patient answer backed by measured accuracy | Running the eval twice | P2 |
| Drug names from the papers sent to Sarvam as `keyterms` | Better recognition of medicine names in later answers | ~10 min; only helps answers recorded after pages are processed | P2 |

### Explicitly out of scope (say so if asked)

- ABHA/EHR integration (it's the roadmap), PDF upload (P2: rasterise in the browser), pill identification, diagnostic chat, broad interaction checking.
- A second speech provider, multi-clinic permissions, row-level security, pairing codes.
- Phrase-level audio seeking (P2; whole-clip playback is enough).

---

## 3. Architecture (simplified, binding)

```
 Phone (kiosk /k/[token])                    Laptop → projector (/staff)
   │ photo (compressed ≤1600px JPEG)           │ polls /api/encounters/:id/rev every 2s
   │ audio clip (webm/opus or mp4)             │ GET /api/encounters/:id/brief  (computed)
   ▼                                           ▼
 Next.js API routes (Vercel, region bom1) ── server-only keys ──────────────────────────
   ├─ sources: store file → Supabase Storage (private) → sha256 → row
   ├─ process page:  Vision OCR (words+boxes+confidence) → Claude (image + OCR text → JSON)
   │                 → VERIFIER (code) → facts rows
   ├─ process clip:  Sarvam STT (hi transcript [+ en translate]) → Claude (facts + quotes)
   │                 → VERIFIER → facts rows; urgent-trigger check → alert row
   ├─ questions:     rules → eligible candidates → Claude picks one (fallback: priority)
   ├─ review:        nurse confirm/correct/unreadable → new fact revision + event (409 if stale)
   └─ brief:         buildBrief(facts, sources, questions, events) → JSON  (pure function)
 Supabase Postgres (Mumbai) + Storage (private bucket, signed URLs, 5 min)
```

### Six tables (the full schema is created by `prompts/00-scaffold.md`)

| Table | Holds |
| --- | --- |
| `encounters` | id, `token` (unguessable, used in the kiosk URL), alias (D24), patient name and age, language, status (`intake` / `paused_urgent` / `ready`), intake start and end times |
| `sources` | id, encounter, kind (`page` / `clip` / `typed`), storage path, sha256, upload order, processing status, readability, identity status, OCR JSON, transcript (hi), translation (en), document date (raw, ISO, precision), clinic, document type, name on document, model ID, mode (`live` / `replay` / `manual`), error, timings |
| `facts` | id, encounter, source, kind, value (JSON), `quote`, anchor (boxes or null), `verify` (`verified` / `pending_check` / `page_level`), reasons[], subject, assertion, temporality, review state, `supersedes_id`, `superseded_by`, created_by, created_at |
| `questions` | id, encounter, candidate ID, reason, supporting fact IDs, state (`asked` / `answered` / `unknown` / `skipped`), answer source |
| `events` | append-only audit: actor, role, type (nurse_confirm, nurse_correct, nurse_unreadable, doctor_review, alert_created, alert_delivered, alert_ack, intake_resumed, …), payload, time |
| `alerts` | id, encounter, trigger (manual or words), quote, source, requested_at, delivered_at, acked_at, acked_by |

### Derived on every read (no stored copies to keep in sync)

- **Issues:** `runRules(facts, sources, questions)` returns typed issues with supporting fact IDs.
- **Brief:** `buildBrief(...)` returns sections. Each section gets a `hash` of its own rendered content.
- **Brief revision:** a hash of the **entire computed brief** (excluding `generated_at`), so any change moves it: a failed page, an alert delivery, a mode switch, an identity release. `/rev` returns this hash. It also returns a counter (facts plus events), shown as "Snapshot N".
- **Review staleness:** a doctor_review event stores the section hashes. A section is stale when its current hash differs.
- **"Pinned" brief:** the staff client keeps the brief it rendered. Polling sees a new revision and does two things:
  - The **attention strip** (allergy, urgent alert) updates **immediately**.
  - Everything else waits behind the banner "New information: … · Review changes". Clicking it applies the update and highlights the changed sections.

### The verifier (OCR and vision cross-check)

Claude receives the page image **and** the Vision OCR text. For each atomic field it returns:

- `value`: its own reading.
- `ocr_quote`: an exact copy of the OCR text that contains this field, or `null`.
- Subject, assertion and temporality.

Code then decides, using one **normalization** everywhere:

- lowercase
- delete Unicode punctuation and symbols (`\p{P}`, `\p{S}`) **except a `.` between two digits**, so "12.5" stays "12.5"
- keep letters, combining marks (Devanagari matras) and digits
- split into tokens on whitespace **and** at every digit↔letter boundary, so "50mg" becomes "50", "mg"
- never fuzzy-match anything

1. `ocr_quote` is null, or its normalized tokens don't appear as a contiguous run in the normalized OCR text:
   - The field becomes `pending_check` with page-level evidence.
   - Reason: "AI read this from the image; OCR could not confirm it".
2. The quote is found:
   - The matched OCR words give the **highlight box**.
   - Check **agreement** for every kind: each normalized token of `value` must appear as a whole token in the normalized quote. So "12.5" ≠ "125", "25" ≠ "250" (case C18), and "BD" ≠ OCR "8D".
   - If they disagree, the field becomes `pending_check`, e.g. "OCR reads '8D', AI reads 'BD'".
3. Any matched OCR word with confidence below 0.80 → `pending_check`.
4. The drug is not in the dictionary, or the strength is not in that drug's strength list → `pending_check`. **The dictionary never rewrites values.**
5. Otherwise the field is `source_matched` (the source text supports the reading; this is not clinical verification).

`pending_check` facts **appear on the brief in amber** ("pending source check", with a page link) **and** in the nurse queue. Facts with no quote and no page never appear. That is how "uncited lines never reach the doctor" stays true without leaving the brief empty on messy handwriting.

The same verifier runs on voice: `quote` must appear in the Hindi transcript (Devanagari, normalized the same way). The agreement check doesn't apply to voice, because there `value` is a restatement.

**Required unit tests:** 12.5 vs 125, 25 vs 250, BD vs 8D, "50mg" vs "50 mg" (these agree), and a missing quote.

### Rules engine (TypeScript, deterministic, versioned)

| Rule | Output (worded as a question for the clinician, never advice) |
| --- | --- |
| `allergy.recorded` | Attention strip: "Penicillin allergy recorded (Clinic A, 14 Aug, p4). Reaction not recorded." |
| `allergy.class_exposure` | Documented allergy plus any prescription of a drug in that class (narrow table: penicillins, sulfonamides, NSAIDs). Output: "Amoxicillin (a penicillin) was prescribed 10 Sep, Clinic C, p5. A penicillin allergy is recorded. For clinician review; current use unknown." |
| `med.strength_changed` | The same drug at different strengths across documents → "Metoprolol 25 mg (14 Aug) → 50 mg (4 Sep)" |
| `med.reported_differs` | Patient-reported strength differs from the latest document → "Patient reports 25 mg; latest prescription 50 mg" |
| `med.unidentified` | "White tablet" with no name → ask for the strip/box; never infer from colour |
| `complaint.onset_missing` | A **symptom** complaint (kind `complaint`) with no onset/duration → eligible question. A `visit_reason` such as "showing old papers" doesn't count |
| `lab.range` | Value vs the report's own printed range, same unit only → below / within / above; otherwise unclassified |
| `doc.identity_mismatch` | The page **matches** if the ID matches, or if the first names are close (edit distance ≤ 2, or one is a prefix of the other) and the age is within ±1. Parse ages written as "52", "52 M", "52 years" or "52y". **Mismatch only when the name is clearly different** ("Sita" vs "Ramesh") → withhold the page plus the "Is this report yours?" question. No name → unchecked, not withheld |
| `doc.date_missing` | Undated bucket; never the upload date. Numeric dates are read as DD/MM and labelled "assumed DD/MM" |
| `urgent.words` | Fixed Hindi/Hinglish/English list (`data/urgent-triggers.json`) → pause the kiosk and raise an alert. False positives go to staff (the safe direction); the system never says "safe" |

### Modes (always visible in the staff header)

- `LIVE` (badge).
- `REPLAY`: results recorded earlier, **matched by sha256 of the exact file**. It works only when the same image file is uploaded, so **keep the demo photos in the phone gallery**. Unseen files get no canned result.
- `MANUAL`: staff typed it.

### Access (enough for a synthetic demo; say so honestly)

- Kiosk: `/k/[token]`, where the token is a 16+ character random string, opened by QR.
- Staff: `/staff` behind `STAFF_PASSCODE`, with a role switch (Nurse Priya / Dr Sharma) labelled **"Demo roles"**.
- All database and storage access goes through server routes using the Supabase secret key. The browser never gets the key. Source images use 5-minute signed URLs.
- Roadmap answer for judges: ABHA-linked identity, row-level security, and DPDP-compliant consent and retention.

### AI calls (settle the details in the smoke tests, don't assume)

**Claude** (`@anthropic-ai/sdk`):

- Use `client.messages.parse()` with `output_config: { format: zodOutputFormat(Schema) }` and read `parsed_output`.
- Model from `PARCHI_MODEL`, default `claude-opus-5-5`. Thinking can't be disabled on Opus 5.5; set `output_config.effort` explicitly. **Measure per-page latency at `low` and `medium` in hour 1**, then pick one.
- Treat `stop_reason` of `refusal` or `max_tokens`, and a null `parsed_output`, as a **visible processing failure**, never as empty success.
- **Warm the schemas before going on stage**: the first call with a new schema pays a compile cost.

**Google Cloud Vision**:

- Call `POST https://vision.googleapis.com/v1/images:annotate?key=…` with `DOCUMENT_TEXT_DETECTION`.
- In the smoke test, try with and without `languageHints: ["en-t-i0-handwrit"]` and keep whichever reads our pages better.
- If the API key doesn't work, use a service account with the JSON **inlined in an env var** (`GOOGLE_CREDENTIALS_JSON`), never a file path on Vercel.

**Sarvam STT**:

- `POST https://api.sarvam.ai/speech-to-text`, header `api-subscription-key`, `model=saaras:v4`, `language_code=hi-IN`. The clip limit is 30 seconds, and we cap recording at 25.
- English: if `mode=translate` works, make a second call in parallel. Otherwise Claude translates, and the result is **labelled "AI translation"**.

**Sarvam TTS**:

- `POST https://api.sarvam.ai/text-to-speech` with JSON `{text, language_code: "hi-IN", model: "bulbul:v3", speaker, output_audio_codec: "mp3"}`. The response is `audios[0]` (base64). The limit is 2,500 characters.
- Pre-generate the MP3s for the question bank with `scripts/gen-tts.ts` and commit them to `public/audio/`.

**Uploads**:

- Vercel request bodies are limited to **4.5 MB**, so compress photos on the device (long side ≤1600 px, JPEG quality 0.85, usually 300–700 KB).
- Set `export const maxDuration = 60` on processing routes. The Hobby plan allows up to 300 s.
- At most **2 pages per encounter** process at once. The rest wait as `uploaded` and start when one finishes. This keeps us under Anthropic rate limits.

---

## 4. Team and file ownership (three parallel Claude Code sessions, no merge fights)

The roles assume three people, including our medical teammate. If the medical teammate doesn't code, C still drives Claude Code for the staff UI, because the prompts carry the detail, and owns all clinical content.

| Person | Owns (folders) | Prompt file |
| --- | --- | --- |
| **A: Pipeline** | `lib/pipeline/*`, `lib/verify/*`, `lib/rules/*`, `lib/brief/*`, `lib/questions/eligible.ts`, `app/api/kiosk/[token]/pages/*`, `app/api/sources/*`, `app/api/encounters/[id]/{brief,rev}`, `scripts/eval.ts`, replay | `prompts/A-pipeline.md` |
| **B: Kiosk** | `app/k/*`, `components/kiosk/*`, `lib/speech/*`, `lib/questions/pick.ts`, `app/api/kiosk/[token]/{answers,questions,help,complete}`, `scripts/gen-tts.ts`, `public/audio/*` | `prompts/B-kiosk.md` |
| **C: Staff + clinical** | `app/staff/*`, `components/staff/*`, `app/api/facts/[id]/review`, `app/api/encounters/[id]/doctor-review`, `app/api/alerts/[id]/*`, print CSS; **plus** props, gold labels, `data/*.json` review, Hindi copy review, the doctor persona in the demo | `prompts/C-staff.md` |

### Rules for working in parallel

1. `lib/types.ts` and the SQL schema are created **once** by the scaffold (A). After that, any change to them is announced aloud and committed alone.
2. C builds the staff UI against `fixtures/brief.sample.json`, which has the exact shape `buildBrief()` returns, created by the scaffold. C is never blocked on A.
3. B builds the kiosk against the real API routes. Until A's processing is live, the routes return explicit `processing` states.
4. Commit small and often to `main`, and pull before every prompt. Each person stays in their folders.
5. **Integration checkpoints are hard stops:** everyone stops, pulls, and runs the story together.

---

## 5. Timeline (relative hours; replace with clock times once we know the deadline)

| Time | A: Pipeline | B: Kiosk | C: Staff + clinical | Gate (all must see it work) |
| --- | --- | --- | --- | --- |
| **H+0:00–0:45** | Scaffold, push, Vercel deploy, env vars | Sarvam STT/TTS smoke tests on the demo phone | Props; Vision + Claude handwriting smoke test; Supabase | Deployed URL; each provider answered one real request |
| **H+0:45–2:30** | Upload → Vision → Claude → verifier → facts. Brief API from real facts. Evidence API (signed URL + boxes) | Kiosk flow: language/consent → record/stop with real mic level → STT → read-back with confirm/edit/re-record → text fallback → photo capture with compression and per-page status | Staff layout to the reference; brief from the sample JSON; evidence drawer (page with highlight box, audio player); encounter rail; create encounter + QR | **Checkpoint 1 (H+2:30):** a phone photo of handwritten p1 and a spoken complaint → the projector brief shows the medicine with a highlighted ink box and the complaint with ▶ playing the real clip |
| **H+2:30–4:30** | Rules engine (all rules in §3); ledger counts; timeline; labs; identity withholding; REPLAY mode; dedupe by hash | Questions: eligibility → Claude pick → reviewed template with **pre-generated Hindi audio** → पता नहीं/skip; urgent words → pause + alert + waiting screen + "acknowledged" only after staff ack; help button on every step | Nurse queue (ink crop, confirm/correct/unreadable → revision + event, 409 if stale); attention strip; change banner + section highlight; "Mark reviewed" → stale badges; alert chime + Acknowledge | **Checkpoint 2 (H+4:30):** the full demo story (§6) end to end on the real phone and projector, including the page-4 reveal and the urgent scenario |
| **H+4:30–5:30** | Fix checkpoint-2 bugs; `scripts/eval.ts` on the gold set | Fix bugs; phone layout; Hindi copy polish; blur hint | Fix bugs; visual polish to the UI reference; intake and evidence timers | **Feature freeze at H+5:30.** Tag `demo-v1` |
| **H+5:30–6:30** | Run the eval → numbers for the pitch; warm the schemas; record the REPLAY fixtures from the demo photos | Rehearse the kiosk part ×3; test with Wi-Fi off (text fallback, help message) | Rehearse the staff part ×3; finalise the pitch slide with measured numbers | Two full timed rehearsals under 4 minutes |
| **H+6:30–7:15** | Record the **backup video** of a full live run (mode badge visible) | Reset procedure rehearsed | Q&A drill (§8) | Video saved on two devices |
| **H+7:15–8:00** | Buffer. Only demo-breaking fixes, and only with a rehearsal afterwards | Buffer | Buffer | Final deploy = the rehearsed commit |

### Cut order if behind at checkpoint 1

Print parchi → Haiku comparison → keyterms → blur hint → QR → identity withholding UI → REPLAY mode → TTS audio (the questions still show as text) → doctor review staleness. Show the banner only.

**Never cut:**

- Handwriting read with the ink box
- Voice clip playback
- Prescribed vs taking
- The allergy reveal and the amoxicillin flag
- Nurse correction
- The urgent stop and acknowledgement
- The ledger's citation coverage ("0 lines without a source link")
- Text fallback

**If checkpoint 1 fails, all three people swarm the broken link.** No new UI work until the golden path works.

---

## 6. The demo (3:00 main + 0:30 urgent)

**Setup:**

- Projector shows `/staff` as Dr Sharma.
- The phone kiosk is on a stand, already open via QR.
- A plastic folder holds the handwritten p1, p3, p5 and p4. p4 is at the bottom, out of order.
- Lab reports p2 and p6 are in the phone gallery ("from WhatsApp").
- Headphones or a speaker are ready for clip playback.
- The encounter is created as exactly **Ramesh, 52, SYN-R52**. The identity rule compares every page against it. Do the same on every reset.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | Hold up the folder | "It's 11 am at a Jodhpur OPD. Ramesh has papers from three clinics and two minutes with Dr Sharma. Today the doctor will read his story, not his folder." |
| 0:15 | Kiosk: "अपने पर्चे और रिपोर्ट की फोटो लीजिए।" plays. Photograph handwritten **p1 and p3 first**, then p5; add p2 and p6 from the gallery. Chips show "पढ़ा जा रहा है" | "Ramesh starts by photographing his papers: handwritten prescriptions, and lab reports from WhatsApp." |
| 0:40 | "आज आपको क्या परेशानी है?" plays aloud. A teammate answers in Hindi: "आज पुराने पर्चे और रिपोर्ट दिखाने आया हूँ। दवा का नाम याद नहीं है। सफेद गोली लेता हूँ।" (a visit reason, not a symptom, so no onset question) | "While the papers are read, he speaks in Hindi. The kiosk also speaks its questions, for patients who can't read." |
| 0:55 | Read-back "मैंने यह समझा: …" → सही है | "He confirms what we understood. That's his record, in his words." |
| 1:05 | Question plays: "आप पुरानी दवा ले रहे हैं या नए पर्चे वाली?" (eligible because the papers show 25 mg and then 50 mg). Answer: "मैं अभी पुरानी 25 मिलीग्राम वाली दवा ले रहा हूँ। नई दवा अभी खरीद नहीं पाया।" | "We didn't script this question. It exists because two clinics wrote different strengths. Only Ramesh knows which one he takes." |
| 1:25 | Projector: the brief | "One screen. Concern in his words, prescribed vs actually taking, labs with the report's own range, a dated timeline." |
| 1:40 | Tap "Metoprolol 50 mg": the drawer opens on the ink with the highlight. Tap ▶ on "Patient reports 25 mg": his voice plays | "Every line opens its source: the ink or his voice." |
| 1:55 | Ledger: "… sourced · 2 AI readings held back · 1 pending check". Switch to Nurse: the amber item shows the ink crop → Confirm reading | "OCR reads every page and the AI's reading must match it. When they disagree, a nurse checks the ink, logged with name and time. Checking the reading doesn't approve the medicine." |
| 2:15 | Doctor clicks **Mark reviewed** | (pause) |
| 2:20 | "Ramesh finds one more paper at the bottom of his folder." Photograph p4 | |
| 2:30 | **The red strip appears at once:** "Penicillin allergy recorded (Clinic A, 14 Aug)", and "Amoxicillin (a penicillin) was prescribed 10 Sep by Clinic C. For clinician review; current use unknown." Allergies section: "changed since your review" | "This is the scene from the problem statement: an allergy on page four that nobody saw, and a different clinic prescribed a penicillin. Parchi doesn't diagnose or advise. It makes sure the doctor sees it, with the source one tap away." |
| 2:45 | Tap → p4 ink | "Reaction details unknown, and we say so." |
| 2:55 | Back to the brief | "60 seconds to read. Every line sourced. The two minutes go back to examining Ramesh." |
| **+0:30** | New encounter: "अभी सीने में तेज दर्द हो रहा है।" → the kiosk stops with "स्टाफ को बुलाया जा रहा है"; staff chime and red alert → Acknowledge → the kiosk shows "स्टाफ ने आपका अनुरोध देख लिया है" | "Urgent words stop the paperwork. The patient only sees 'staff acknowledged your request' after a real person clicks Acknowledge. Not triage. Never 'safe to wait'." |

**The time slots are targets.** Reset them from the checkpoint-2 run.

- If pages are still being read at 1:05, turn to the projector and show the brief filling in live (that demonstrates live updates), then return to the kiosk.
- If the strip-photo question appears after the medicine question, tap छोड़ें. That shows skip is always allowed.

**Then, if time allows, the judge challenge:** hand a doctor-judge the paper folder and ask "Is Ramesh allergic to anything? What metoprolol strength is he taking?" Time it, then point at the brief.

**Honest-measurement slide:** show the numbers from `scripts/eval.ts` on the handwritten gold set, with the denominator, in this form: "N handwritten fields, X correct, Y routed to nurse, Z wrong-and-unflagged". Show the ledger count, and the median evidence-open time.

### Fallbacks (rehearse each once)

| Failure | Do |
| --- | --- |
| Venue Wi-Fi dies | Switch both devices to the phone hotspot (pre-paired). |
| A provider is down or slow | Switch the staff header to REPLAY and upload the **same gallery photos**, which match by hash. Say "replay mode" out loud. |
| Microphone fails | Type the Hindi answer. The text path is the same pipeline. |
| Everything fails | Play the backup video and narrate. Then show the code and the eval numbers. |

**Reset between runs:** "New encounter" on staff → QR → the kiosk opens a fresh encounter. Old encounters remain for audit.

---

## 7. Props and gold set (C owns; start at H+0:00)

**Write on prescription-style paper with a clinic header**, as a doctor would: some shorthand ("Tab", "Cap", "BD", "TDS"), but **legible**. These must copy `fixtures/packet.json` exactly so that `gold.json`, the expected issues and the demo stay valid, and so the typeset PNGs remain an identical fallback.

| Page | Clinic and date | Content |
| --- | --- | --- |
| p1 | Clinic A · 14 Aug 2026 | Ramesh, 52 M (ID SYN-R52). "Tab Metoprolol 25 mg BD" |
| p3 | Clinic B · 4 Sep 2026 | Ramesh, 52 M. "Tab Metoprolol 50 mg BD" |
| p5 | Clinic C · 10 Sep 2026 | Ramesh, 52 M. "Cap Amoxicillin 500 mg TDS × 5 days" |
| p4 | Clinic A history note · 14 Aug 2026 | Ramesh, 52 M. "Allergy: Penicillin. Reaction: not recorded." Put one or two routine lines around it so the allergy is genuinely buried |
| p2, p6 | Lab reports | Use `fixtures/page-02.png` and `page-06.png` in the phone gallery (lab reports are printed, and often arrive on WhatsApp) |

**Extra test pages** (for the eval and the failure demos, not the main story):

- **x1:** a naturally messy prescription, e.g. "Tab Amlodipine 5 mg OD", written quickly. Use it to show the nurse queue if the main pages read cleanly. **Don't fake errors.**
- **x2:** a page for a different patient ("Sita, 34 F"), to test identity withholding.
- **x3:** a deliberately blurred photo of p3, to test the retake hint.
- **x4–x8:** five more short handwritten prescriptions (any common drugs from `data/drugs.json`) for the eval.

**Gold labels:** for every handwritten page, C writes the intended values into `fixtures/gold-handwritten.json` (same shape as `gold.json`) **before** anyone looks at model outputs. Illegible means label it illegible.

**Write dates with the month in words** on the demo props ("4 Sep 2026") so the timeline is unambiguous.

**Write "Ramesh" and "52 M" clearly on every page.** The identity rule compares them with the encounter. C's smoke test must confirm that Claude reads both correctly from the handwriting.

---

## 8. Judge Q&A (drill these)

**"How accurate is the handwriting reading?"**

> "On our N handwritten test fields: X correct, Y sent to a nurse, Z wrong and not flagged." Show the eval output. "OCR scores and quote checks don't prove medical correctness. That's why uncertain readings go to a human."

**"Isn't this just ChatGPT on a photo?"**

> "A general model can read a photo. What it can't do is give the doctor a brief where every line opens its source. Ours shows the patient's account next to the prescriptions, asks only about gaps, keeps a nurse in the loop for disagreements, and makes the doctor's review stale when new evidence arrives." Then demo one of those.

**"Does it diagnose or change medicines?"**

> "No. It organises what's documented and what the patient reports. A discrepancy is a question for the doctor, never an instruction."

**"Privacy? DPDP Act?"**

> "Today: synthetic data only, private storage, server-side keys, an audit log of every human action. For production: consent at the kiosk, India-region storage (our database is in Mumbai), ABHA-linked identity, and de-identification before external AI calls."

**"Cost per patient?"**

> Quote the measured tokens and calls from the logs, e.g. "about N pages × M calls ≈ ₹X". If the Haiku comparison ran: "₹Y with a smaller model at Z accuracy."

**"What if the internet is down at a district hospital?"**

> "The text path and the help button never depend on AI. Everything retries. And a printed parchi works without a screen (if built)."

**"Does it work in Marwari / other languages?"**

> "Sarvam covers 22 Indian languages. We tested Hindi and Hinglish today; we won't claim the others until we've tested them."

**"Time saved?"**

> "2.3 hours per desk per day is a target if we save 60 seconds per patient. Today we measured X seconds to open evidence and Y minutes of kiosk time. A real time study is our next step."

**Never claim:** that no other tool does this, clinical validation, safety, or an accuracy percentage without its denominator.

---

## 9. Smoke tests (first 45 minutes, real requests only)

```bash
# Sarvam STT (B) - phone clip copied to laptop
curl -X POST https://api.sarvam.ai/speech-to-text -H "api-subscription-key: $SARVAM_API_KEY" \
  -F file=@clip.webm -F model=saaras:v4 -F language_code=hi-IN -F mode=transcribe
curl ... -F mode=translate          # if rejected on v4, retry with -F model=saaras:v3

# Sarvam TTS (B)
curl -X POST https://api.sarvam.ai/text-to-speech -H "api-subscription-key: $SARVAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"आज आपको क्या परेशानी है?","language_code":"hi-IN","model":"bulbul:v3","speaker":"priya","output_audio_codec":"mp3"}'
# response: {"audios":["<base64>"]} - decode audios[0] to .mp3 and play (if "priya" is rejected, omit speaker to use the default "shubh")

# Google Vision (C) - handwritten p1 photo, base64 in req.json
curl -X POST "https://vision.googleapis.com/v1/images:annotate?key=$GOOGLE_VISION_API_KEY" \
  -H "Content-Type: application/json" -d @req.json
# req.json: {"requests":[{"image":{"content":"<b64>"},"features":[{"type":"DOCUMENT_TEXT_DETECTION"}]}]}
```

**Anthropic:** check the org's rate-limit tier (Console → Settings → Limits) before the first run with several pages in parallel.

**Claude handwriting check (C, with Claude Code's help):** a 30-line `scripts/smoke-claude.ts` that sends the photo plus the Vision text, prints the parsed JSON and the elapsed time at `low` and `medium` effort, and reports which fields' quotes match the OCR text. **Write down the result in `docs/HANDOFF.md`.** It decides how much ends up in the nurse queue.

---

## 10. Definition of done (demo-critical acceptance)

Replaces the kit's A01–A20 for today; the rest is stretch.

1. A handwritten photo taken on the phone → the brief shows medicine name, strength and frequency, each opening the ink with a highlight box or labelled page-level evidence.
2. A spoken Hindi answer → the brief shows the Hindi quote and the English line, and ▶ plays the same stored clip on the projector.
3. A transcript correction keeps the original (visible in the drawer).
4. The 25 mg vs 50 mg difference produces the old/new question; a case with matching strengths doesn't. A visit reason without a symptom ("showing old papers") doesn't trigger the onset question; "पेट में जलन है" does.
5. पता नहीं / skip are stored; the question isn't asked again; intake completes.
6. A nurse correction creates a new revision with actor and time; the brief updates through the banner; a stale double-submit gets a 409.
7. p4 arrives after "Mark reviewed" → the allergy and amoxicillin strip appears immediately, Allergies shows "changed since your review", and the old review event stays in history.
8. The urgent phrase → the kiosk pauses; the staff alert arrives with a chime; the kiosk shows "acknowledged" only after the staff click. With Wi-Fi off, the help request shows "please tell nearby staff now" and never a false "called".
9. The ledger shows 0 lines without a source link (citation coverage, not proof of correct interpretation); no diagnosis text anywhere.
10. Both devices refreshed → everything persists.
11. Screens checked at 390×844 (phone) and 1366×768 (projector): no clipped strip, Hindi renders correctly, primary buttons visible.
