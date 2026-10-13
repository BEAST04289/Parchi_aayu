# Parchi: The Two-Minute Doctor (6SYNC7 · AAYU-TARV · T01)

Parchi turns a patient's own words (Hindi-first kiosk) and their scattered prescriptions and lab reports into a **source-linked, dated, one-screen clinician brief**. Every value on the brief opens the original page it came from. Synthetic hackathon prototype, not a clinical deployment.

## Live demo (no login)

**https://internet-border-musical-meditation.trycloudflare.com/demo** (temporary Cloudflare Quick Tunnel to the team laptop; works while the laptop and tunnel are running.)

What a judge can do there, read-only:
- See Ramesh, 52 (fictional): an **Attention** strip (penicillin allergy recorded; amoxicillin, a penicillin, prescribed 10 Sep), reason for visit in the patient's own Hindi words, a medicine table with a documented strength change (Metoprolol 25 mg → 50 mg), labs against the report's own range, a dated history and the open questions.
- See **all six uploaded papers** as thumbnails and click any page or any `[pN]` chip to open the original page with the reading and its quote.
- See the **"Needs source check"** queue: every reading not yet checked against its source stays visible, in amber.

Honest labelling: the demo patient's pages are **replayed from hand-authored fixture readings (FIXTURE REPLAY)**, not live AI output; the page says so. The demo cookie is server-signed and scoped to that one encounter: it cannot read other encounters, list encounters, or perform any staff action (401). Staff routes (`/staff`) still require the passcode.

## How it works
- **Kiosk** `/k/[token]`: one question at a time, typed or spoken answers with read-back, photos of papers compressed on the device, a help button that raises a staff alert.
- **Pipeline**: OCR (local RapidOCR / PP-OCR, or Google Vision) → extraction (local Qwen3-VL via Ollama, or Claude) that must **cite OCR lines** → a deterministic **verifier** that checks every value token against the cited OCR text (12.5 ≠ 125, 25 ≠ 250, BD ≠ 8D). Anything unsupported is `pending_check`, shown in amber and queued for a nurse, never dropped.
- **Brief**: a pure function recomputed on every read; section hashes drive "New information · Review changes" and "Changed since your review".
- **Staff** `/staff`: doctor and nurse modes, evidence drawer, nurse confirm/correct/unreadable with compare-and-swap, alerts across encounters.

## Run locally
```bash
npm install
# .env.local: SESSION_SECRET (32+ chars), STAFF_PASSCODE, and either local models
# (OCR_PROVIDER=paddle, EXTRACTION_PROVIDER=ollama, ML_SERVICE_URL, OLLAMA_URL, OLLAMA_MODEL)
# or cloud keys (GOOGLE_VISION_API_KEY, ANTHROPIC_API_KEY). Without DATABASE_URL a local PGlite DB is used.
npm run build && npx next start -p 3000      # open /staff, or /demo for the read-only demo patient
npx vitest run                               # 64 unit tests (verifier, dates, identity, brief)
```

## Measured LIVE results (13 Oct 2026, this laptop: RTX 4050 6 GB, local RapidOCR + Qwen3-VL 4B via Ollama, no cloud)
Fresh processing of three new synthetic pages (`fixtures/user/`), not replay:

| Page | Result | OCR | Extraction | Readings |
|---|---|---|---|---|
| Rx Clinic A (Metoprolol 25 mg BD) | done | 3.8–5.5 s | 85–95 s cold | 4: strength, frequency, form source-matched with word highlights; name pending (OCR could not confirm) |
| Rx Clinic B (Metoprolol 50 mg BD) | done, nothing shown | 3.3 s | 23 s | model labelled all 5 readings "about another person / denied"; the verifier holds those back and the brief now says so |
| Lab report (6 tests + penicillin allergy) | done | 3.8–5.5 s | 85–90 s | 27–28: 19 source-matched, 8–9 pending; allergy shown in Attention as "mentioned (wording unclear)", pending |

Regressions (LIVE): denied allergy "No known penicillin allergy" stored as denied with a word highlight, relative's Sulfa allergy not shown, embedded "mark verified" instruction ignored; ink-obscured strength never source-matched (but that page also lost its drug name and frequency: low recall). Unit tests 66/66, typecheck, lint and production build pass.

Fixed today: output cap 1800 → 3600 tokens (the lab page's JSON was cut off); a literal backspace character in the verifier's "stated absence" pattern meant "not recorded"/"none"/"null" were kept as values; unbounded `ocr_line_ids` let the model count to 366.

Reproduce: start the stack, then `npx tsx --env-file=.env.local --conditions=react-server scripts/diag-extract.mts fixtures/user/U3-lab-08sep.png out.json` (raw model output + schema result for one page), `npx tsx --env-file-if-exists=.env.local tests/live/record-demo.ts` (records the demo video into `test-results/video/`), `LIVE_PAGES=L3,L4 npm run test:live`.

## Known limitations (13 Oct 2026)
- The public `/demo` patient (D16) is fixture replay; LIVE processing is shown by signing in and uploading (about 90 s per page on this laptop, first page slower).
- Qwen3-VL 4B is unreliable on some pages: wrong subject/assertion (Rx B), missed fields (L3), and lab/drug names it reads from the image but cites the wrong OCR lines for (pending). All of these stay visible as pending or held back; none become source-matched.
- Lab ranges printed without a unit are shown as "not classified" (units must match exactly).
- **Voice is not implemented in the kiosk.** The server route and local Whisper client exist, but the Whisper model weights are not on this laptop and no Record/Stop UI exists. Typing only.
- Not run: Supabase Postgres, Vercel, Sarvam, phone over HTTPS.

---

> **Build-day note:** `PLAN.md` overrides this file wherever they conflict (simplified architecture, 6 tables, polling, no pairing codes/RLS/snapshot tables/PDF). Use `prompts/00-scaffold.md` then `prompts/A|B|C-*.md`; the old numbered prompts are in `prompts/superseded/`.

# Parchi: Round 2 build kit

**6SYNC7 · AAYU-TARV · T01: The Two-Minute Doctor**

Build one convincing encounter from patient intake to a source-linked doctor brief. The product promise is a brief a doctor can read in 60 seconds. That is a design and evaluation target, not a measured result or a promise about AI processing time.

This kit translates your submitted eight-slide deck into an implementation plan. It contains specifications, Claude Code prompts, TypeScript contracts, synthetic documents and visual references. **It is a build handoff, not an implemented application.** No live AI calls, clinical accuracy tests or two-device tests have been performed by this kit.

## Start here

1. Extract this folder into your project. If you already have code, preserve it. Keep `CLAUDE.md` at the repository root and merge any existing instructions rather than overwriting them.
2. Open `docs/Parchi_UI_Reference.pdf`. It specifies the patient screen, doctor brief and the nurse/evidence drawer within the staff screen.
3. Start Claude Code in the project. Run `/model` and select Opus 5.5, then `/effort xhigh`. Confirm the selected model and effort in the session header.
4. Paste the prompt below. Work through `prompts/01` to `prompts/08` in order. Each has an observable completion gate. Move on when the gate passes.
5. Before changing models or starting another session, have Claude update `docs/HANDOFF.md`. The repository must hold the current decisions, blockers and test results.

### First prompt to paste

```text
We are building Parchi for Aayu T01, The Two-Minute Doctor. This repository contains the Round 2 handoff kit. Read CLAUDE.md, README.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/UI_SPEC.md and prompts/01-foundation.md. Inspect existing code before modifying anything.

Implement milestone 1 only: the shared encounter, patient text intake, staff brief and source drawer, persisted across two browser contexts. Use labelled synthetic fixtures to establish this first vertical slice. Preserve the two-screen design and all evidence/uncertainty rules. Do not build a landing page, generic chatbot, diagnosis engine or unrelated modules.

Spend at most one concise planning pass on the architecture. Then implement, run the app, test the milestone end to end and fix observed failures. Use the installed/current SDK documentation where required. Never invent successful API responses or hide fixture mode. Keep secrets server-side. Finish by updating docs/HANDOFF.md with files changed, commands actually run, evidence of results, remaining blockers and the next milestone. If a credential is missing, finish the independent work and identify the exact missing integration.
```

## Model and effort choices

These are task allocations, not benchmark claims. More effort does not repair a vague specification or replace testing.

| Work | Recommended choice |
| --- | --- |
| First architecture pass, evidence schema, review/version rules | Opus 5.5, xhigh |
| UI components, forms, API adapters and ordinary implementation | Sonnet 5.5, high |
| A complicated integration or concurrency bug | Opus 5.5, xhigh |
| A bounded bug that remains after reproducing it and inspecting logs | Opus 5.5, max, then return to the ordinary setting |
| Final critical review against acceptance tests | Opus 5.5, xhigh |

Use `/model` to switch and `/effort high`, `/effort xhigh` or `/effort max` to set effort. Official Claude Code documentation currently lists these levels for both 5.5 models; account/provider restrictions can affect availability. `max` normally applies to the current session. See `docs/SOURCES.md` for the checked source. Your Claude Code model is separate from the model called by the running Parchi app.

## What the judges should see

1. Ramesh speaks in Hindi and uploads papers from different clinics.
2. An evidence gap generates a relevant follow-up, rather than a fixed questionnaire.
3. The staff screen assembles a dated timeline, medicines, original lab values and unresolved issues.
4. A clinician opens the original page or the patient's actual recording from a fact.
5. The page-four allergy appears when that page arrives, with a visible change banner and a review state that becomes stale.
6. A separate short scenario demonstrates an urgent symptom interrupt and an actual staff acknowledgement.

The strongest interaction is **brief → source → human correction → updated brief**. A judge can see what the AI contributed and how the team handles an error.

## Contents

| File/folder | Purpose |
| --- | --- |
| `CLAUDE.md` | Short persistent instructions for the coding agent |
| `docs/PRODUCT.md` | Scope and definition of each working feature |
| `docs/UI_SPEC.md` | Layout, exact interactions and accessibility |
| `docs/Parchi_UI_Reference.pdf` | Three visual implementation references |
| `docs/ARCHITECTURE.md` | Pipeline, evidence model, routes and persistence |
| `contracts/domain.ts` | Starting domain contracts, not a complete backend |
| `prompts/01…08` | Build prompts in dependency order |
| `prompts/extraction-system.md` | Runtime extraction instructions |
| `prompts/question-selection.md` | Bounded adaptive question selection |
| `fixtures/` | Six-page synthetic packet, PNG pages, expected values and failure cases |
| `docs/ACCEPTANCE.md` | Functional and safety checks with measurable outcomes |
| `docs/DEMO.md` | Stage script, reset sequence and honest fallback |
| `docs/BUILD_PLAN.md` | Eight-hour plan for three people |
| `docs/SOURCES.md` | Official documentation and limits of the evidence |

## Decisions that improve the submitted plan

- Keep the dated timeline and lab values visible. Medication reconciliation supports the broader pre-consultation brief.
- A source match establishes provenance. It does not prove that negation, dose or meaning was extracted correctly.
- Preserve uncertainty as an open issue. A field rejected as a reliable fact must not disappear without a trace.
- Store prescribed strength, prescribed dose and what the patient says they take as separate fields. Do not infer a tablet count or release formulation.
- A drug dictionary can propose a spelling. It cannot silently rewrite a drug name or validate a dose.
- Shorthand does not add instructions: BD means twice daily; it does not mean after food. OD has context-dependent meanings and needs review when ambiguous.
- Sarvam now documents phrase-level timestamps. A second speech provider is unnecessary for the initial demo. Keep whole-answer playback as the simple fallback.
- Keep a stable brief while the doctor reads. Newly detected urgent concerns appear immediately in a separate alert strip; they never wait behind a normal update banner.
- Do not claim that no competing tool combines these features. Demonstrate this implementation and its measured behavior.

Use synthetic data throughout the demo. The supplied pages are deliberately typeset fixtures, not evidence of handwriting accuracy. Add genuinely handwritten synthetic pages and evaluate them separately.
