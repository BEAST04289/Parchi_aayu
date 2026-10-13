# Current handoff

**Updated 13 Oct 2026, ~11:35 IST.** Repo: `C:\dev\parchi` (git, local commits only; no remote yet). The OneDrive kit folder is now only a copy; this repo is the source of truth.

## Status in one paragraph
The scaffold gate passes in real Microsoft Edge contexts on a **local PGlite database** (21/21 checks, below). Staff sign in, create an encounter with a QR/kiosk link, the patient types a complaint on a second independent context, it appears on the staff brief via the change banner with its source, and everything survives refresh. Access control, alerts across encounters, offline help, nurse compare-and-swap, doctor review staleness and the page-4 allergy reveal all work **without any AI keys**. Fixture replay data drives those checks. **No live provider call has been made**: Supabase, Google Vision, Claude and Sarvam are all unrun because no credentials exist on this machine.

## Missing credentials (exact)
| Variable | Needed for | Where |
| --- | --- | --- |
| `DATABASE_URL` | Supabase Postgres (required on Vercel; local falls back to PGlite) | Supabase → project in Mumbai → Connect → Transaction pooler URI (port 6543) |
| `ANTHROPIC_API_KEY` | Page extraction and typed/transcript extraction | console.anthropic.com |
| `GOOGLE_VISION_API_KEY` | OCR (`DOCUMENT_TEXT_DETECTION`) | Google Cloud → Vision API → Credentials → API key |
| `SARVAM_API_KEY` | Voice (B1) and pre-generated question audio (B2) | dashboard.sarvam.ai |
| `SESSION_SECRET`, `STAFF_PASSCODE` | Staff login | Generated locally in `.env.local` (not committed). Generate new values for Vercel. |

## How to run locally
```bash
cd C:\dev\parchi
npm install
# .env.local already has SESSION_SECRET, STAFF_PASSCODE (read the passcode from that file), PARCHI_MODEL, PARCHI_EFFORT
npm run seed:fixtures      # optional: hand-authored FIXTURE REPLAY rows for fixtures/page-0N.png (stop the server first on PGlite)
npm run build && npx next start -p 3000    # or: npm run dev
# open http://localhost:3000/staff
npm run test:gate          # with the server running: the Edge end-to-end gate; report in test-results/gate-report.json
```
With `DATABASE_URL` set: run `npm run db:migrate` once, then the same commands. The gate assumes a fresh database with the fixture rows seeded.

## Implemented (as built)
- **Data layer:** `lib/db.ts` is plain SQL over `pg` (Supabase) or PGlite (local only; refuses to run on Vercel without `DATABASE_URL`). `supabase/schema.sql` has 8 tables (`encounters, blobs, sources, facts, questions, events, alerts, replays`). RLS is enabled with no policies, and anon/authenticated grants are revoked when those roles exist (Supabase).
  - Idempotency lives in the database: a unique `(encounter, sha256)` on sources, one open alert per encounter (partial unique index), one successor per fact revision (unique `supersedes_id`).
- **Auth:** HMAC-signed staff cookie with expiry, httpOnly, SameSite=Lax, and Secure on HTTPS/Vercel. Fails closed without `SESSION_SECRET`. Every staff route calls `requireStaff()`.
  - Kiosk routes resolve the URL token to exactly one encounter and scope every query to it.
  - Source files are served only by `/api/sources/[id]/file` with a staff session.
- **Pipeline (code complete, not run live):**
  - `lib/pipeline/ocr.ts` calls Vision over REST and normalizes words, boxes and confidence.
  - `extract.ts` uses `messages.parse` + `zodOutputFormat`. Refusal, `max_tokens` or a null parse produce a visible failure.
  - `page.ts` claims at most 2 pages per encounter, inserts facts in one transaction with `done`, stores zero facts on failure with a readable error, upserts the replay row on LIVE success, and in REPLAY uses the exact sha256 only. Processing runs in `after()`; locally this was observed working (P1 below).
  - Verifier: `lib/verify/page.ts` (OCR and vision cross-check; decimals protected; whole-token agreement; low confidence, unknown drug and unusual strength become `pending_check`; another person's facts are held back).
  - Also: deterministic dates (`assumed DD/MM` label) and lenient identity matching.
- **Brief:** `lib/brief/build.ts`, a pure function. It produces:
  - reason for visit (verbatim patient words + extracted facts)
  - medicines (documented by date, with each field's own source chip, BD/TDS expansion only, strength-change flag)
  - labs (report-range status only when the units match exactly)
  - dated timeline + undated bucket
  - attention (allergy recorded, penicillin/sulfa class exposure "for clinician review; current use unknown", identity withheld)
  - open lines (pending checks, failed pages, denied allergy as a documented negative)
  - citation-coverage ledger
  - section hashes over clinical content only, plus a separate `live_hash`
- **Staff UI (`components/staff/*`):**
  - Login with "Demo roles", rail, create encounter + QR.
  - Pinned brief: the attention strip is always current; other changes wait behind "New information · Review changes".
  - "Mark reviewed" sends the hashes on screen.
  - Nurse queue (confirm/correct/unreadable; 409 message on stale).
  - Evidence drawer: page image, zoom, highlight boxes or a "Page-level evidence" label; typed answer with earlier versions; the model/fixture label is shown.
  - Global alert bar for all encounters: delivered is set automatically, then Acknowledge, then Resume intake. Chime with an "Enable alert sound" fallback.
  - LIVE / FIXTURE REPLAY toggle. LOCAL DEV DATABASE and provider-configured badges (booleans only).
- **Kiosk UI (`components/kiosk/Kiosk.tsx`):**
  - Hindi-first with an English toggle.
  - Start → type → read-back (सही है / बदलें, corrections append) → papers (camera/gallery, compressed to ≤1600 px JPEG 0.85 on the device, persisted statuses, retry, **skippable**) → check → done (shown only after the save succeeds).
  - Help on every screen.
  - Urgent pause shows requested / delivered / "स्टाफ ने आपका अनुरोध देख लिया है"; offline shows "नेटवर्क नहीं है। कृपया पास के स्टाफ को अभी बताएं।" with retry.
- **Deterministic urgent words** (`data/urgent-triggers.json`) run on typed answers before any AI; a match pauses intake and raises the alert.

## Commands actually run and observed results (13 Oct, local Windows, Node 24.11.1, Edge via playwright-core 1.64)
- `npm run typecheck` (next typegen + tsc): pass.
- `npx eslint .`: 0 problems.
- `npx vitest run`: **45/45 pass** (synthetic inputs). Covered:
  - normalization, including Devanagari
  - the verifier: 25≠250, 12.5≠125, BD≠8D, 50mg=50 mg, missing quote, low confidence, unknown drug, other-person allergy, invalid boxes giving page-level evidence
  - dates (C06), identity (C11), lab ranges (C07, comparators, unit mismatch), urgent words
  - the brief: verbatim complaint, grouping and dating, pending visibility, stable hashes, C13 staleness, C01 negation, withheld page, corrected answer
- `npm run build` (Next 16.4.0, Turbopack): pass.
- `npm run test:gate` against `next start` + PGlite: **21/21 pass** (`test-results/gate-report.json`):

| ID | Check | Observed |
| --- | --- | --- |
| G1 | Staff login (browser) | Signed cookie httpOnly + SameSite=Lax; LOCAL DEV DATABASE badge shown |
| G2 | Create encounter (browser) | 24-char token, QR + link |
| G3 | Kiosk in an independent context types the complaint | Read-back equals the stored text |
| G4 | Staff sees it without a reload | Banner "New information: reason for visit" → applied; [a1] opens the drawer with the verbatim text |
| G5 | Refresh both | Persisted; staff still signed in |
| S1 | Wrong token | 404 on state/help; page says the link is invalid |
| S2 | Forged, unsigned, tampered, expired (correctly signed) cookies | 401 / 401 / 401 / 401; genuine 200 |
| P1 | LIVE upload, no Vision key | `failed`, "Processing not run: GOOGLE_VISION_API_KEY is not configured on the server.", readability not set to unreadable |
| P2 | Same file again | `duplicate: true`, still 1 page |
| P3 | Original page from the brief | Image loads in the drawer for staff; file/evidence without a session → 401/401 |
| R1 | REPLAY of an unseen file | `failed`, "No recorded result for this exact file (replay mode)…" |
| R2 | REPLAY of p1, p3, p5 | Metoprolol 25 mg (14 Aug) → 50 mg (04 Sep) flag; all readings `pending_check` (page-level); mode `replay` |
| N1 | Two concurrent corrections (nurse + doctor) | One 200 + one 409; stale resubmit 409 "Already updated by Priya at …"; both revisions stored |
| N2 | Patient writes a review / nurse records a doctor review | 401 / 401 / 403 |
| D1 | Mark reviewed → page 4 arrives | Allergy + "Amoxicillin (a penicillin) was prescribed 10 Sep 2026 · Clinic C" appear without clicking the banner; attention stale; medicines/labs still reviewed; review event kept |
| D2 | Allergy source chip | Opens the history-note page with "Page-level evidence" and no highlight box |
| A1 | Doctor on D1, patient D4 presses help | Alert bar for D4 while on D1; kiosk shows "delivered" text before ack and "स्टाफ ने आपका अनुरोध देख लिया है" after; repeat press keeps 1 open alert; no "staff coming"; resume returns the kiosk to intake |
| A2 | Typed "अभी सीने में तेज दर्द हो रहा है।" | Paused, staff alert; completing while paused → 409 |
| A3 | Help while offline | Nearby-staff message; no delivered/ack text; 0 alerts before reconnect, 1 after retry + second press |
| K1 | Skip papers, finish | Done message after save; no horizontal overflow at 390 px |
| V1 | Staff at 1366×768 and 768×1024 | No horizontal page overflow |

Screenshots (actual running screens) are in `test-results/screens/` (gitignored), including kiosk 390×844 start/tell/read-back/papers/check/done/help-delivered/help-acked/offline, staff 1366×768 brief/drawer/allergy-reveal/alert, and staff 768×1024. I inspected them: Devanagari shaping is correct and nothing is clipped in the inspected screens.

## Not run (do not claim these)
- Supabase Postgres (no `DATABASE_URL`). Concurrency was tested on PGlite, which serializes queries. The compare-and-swap logic (conditional update + unique `supersedes_id`) has **not** been exercised under real Postgres concurrency.
- Google Vision OCR, Claude page extraction, Claude transcript extraction: code paths compile against the installed SDK types (`messages.parse`, `zodOutputFormat`, `output_config.effort`) but have **never been called**. No latency, accuracy or schema-compile timings exist yet.
- Sarvam STT/TTS, the microphone, phone over HTTPS, Vercel deployment (including `after()` on Vercel), handwritten pages.
- The fixture replay rows are hand-authored from `fixtures/gold.json`, not recorded outputs. They carry no word positions, so every replayed reading is page-level and pending. They are not evidence of extraction accuracy.

## Deviations from PLAN.md (reason → effect on the demo)
- **Blobs in Postgres** instead of Supabase Storage, served by an authenticated route instead of signed URLs. Reason: one credential fewer, and the same privacy property. Effect: none visible; the DB stores roughly 0.5 MB per photo.
- **pg/PGlite** instead of supabase-js. Reason: real transactions/compare-and-swap, plus local testing with no credentials. Effect: needs `DATABASE_URL` (the pooler URI) rather than a URL + secret key.
- **Revision = clinical section hashes only**, alerts on their own endpoint. Reason: the doctor's own actions and alert delivery must never flash the change banner. Effect: as intended.
- **Voice not built yet.** The kiosk honestly says typing only, and the multipart answers branch returns 501 naming B1.

## Known limitations / open issues
1. Page labels follow upload order (`p1`, `p2`, …), not packet page numbers. In the demo the history note is "the new page", whatever its label.
2. REPLAY matches the exact uploaded bytes. Kiosk uploads are re-encoded JPEGs, so a gallery photo replays only if the same browser produces identical bytes (likely, unverified). Uploading the fixture PNGs via API matches exactly.
3. The alert chime needs a user gesture after a page reload ("Enable alert sound" link). Headless runs show that link.
4. The medicine table repeats a "name" chip per documented line (dense). The nurse queue shows no ink crop yet (the drawer has the page). Both are C polish.
5. Not implemented: `GOOGLE_CREDENTIALS_JSON` (service-account) fallback for Vision; B2 questions (route returns 501); A2 rules `med.reported_differs`, `med.unidentified`, `complaint.onset_missing`; question eligibility.
6. `next dev` rewrites `AGENTS.md`; it is committed as generated.

## Next actions (in order)
1. **Push:** create an empty GitHub repo, then `git remote add origin <url>` and `git push -u origin main`. Teammates clone and run `npm install`.
2. **Supabase (Mumbai):** put `DATABASE_URL` in `.env.local`, then `npm run db:migrate`, optionally `npm run seed:fixtures`, then rerun `npm run test:gate` against Supabase.
3. **Keys:** add `GOOGLE_VISION_API_KEY` + `ANTHROPIC_API_KEY`. In a LIVE encounter upload `fixtures/page-03.png` and expect three `source_matched` facts with highlight boxes. Then photograph handwritten p1. Record per-stage timings (`sources.timings`) at effort low vs medium below.
4. **Vercel:** import the repo, region bom1, env vars (new `SESSION_SECRET`/`STAFF_PASSCODE`, `DATABASE_URL`, keys). Open `/k/…` on the demo phone over HTTPS.
5. **Parallel tracks:** B1 voice (Sarvam), A2 rules + eligibility, C polish + props + `fixtures/gold-handwritten.json` before seeing outputs.

## Smoke-test results (still to fill in)
- Sarvam STT `saaras:v4` `mode=transcribe`: ___. `mode=translate` on v4: ___ (if rejected, does v3 work?).
- Sarvam TTS `bulbul:v3`: ___ (response shape, codec).
- Vision API-key auth: ___. Handwritten p1: OCR words and confidence ___.
- Claude extraction on handwritten p1: fields ___, quote matches ___. Latency at effort low ___ s, medium ___ s.
- Next.js `after()`: works locally under `next start` (P1). Vercel: ___.
- Phone + deployed HTTPS: mic permission ___, MediaRecorder MIME ___.
