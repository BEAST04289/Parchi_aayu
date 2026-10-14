# Current handoff

**Updated 13 Oct 2026, ~11:40 IST.** Repo: `C:\dev\parchi` (git, local commits only; no remote yet). The OneDrive kit folder is now only a copy; this repo is the source of truth.

## Status in one paragraph
The scaffold gate passes in real Microsoft Edge contexts on a **local PGlite database** (22/22 checks, below). Staff sign in, create an encounter with a QR/kiosk link, the patient types a complaint on a second independent context, it appears on the staff brief via the change banner with its source, and everything survives refresh. Access control, alerts across encounters, offline help, nurse compare-and-swap, doctor review staleness and the page-4 allergy reveal all work **without any AI keys**. Fixture replay data drives those checks. **No live provider call has been made**: Supabase, Google Vision, Claude and Sarvam are all unrun because no credentials exist on this machine.

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
  - `page.ts` claims at most 2 pages per encounter (only claims younger than 3 minutes count), inserts facts in one transaction with `done`, stores zero facts on failure with a readable error, upserts the replay row on LIVE success, and in REPLAY uses the exact sha256 only. Processing runs in `after()`; locally this was observed working (P1 below).
  - Waiting pages are started by `kickQueue()`, which the polled endpoints call (kiosk state, staff rev). It also marks claims older than 3 minutes as failed ("Processing was interrupted. Retry."), so a killed invocation cannot strand the queue. Provider budget: Vision 15 s + Claude 75 s (no SDK retry) inside `maxDuration = 120`.
  - Verifier: `lib/verify/page.ts` (OCR and vision cross-check; decimals protected; whole-token agreement; low confidence, unknown drug and unusual strength become `pending_check`; another person's facts are held back).
  - Also: deterministic dates (`assumed DD/MM` label) and lenient identity matching. Label words ("Name:", "Pt.", "Shri") are ignored, a close name with a different age gives `unchecked` (never withheld), and only a clearly different name withholds. `findDrug` ignores leading form words ("Tab", "Cap") for matching only; the value is never rewritten.
- **Brief:** `lib/brief/build.ts`, a pure function. It produces:
  - reason for visit (verbatim patient words + extracted facts)
  - medicines (documented by date, with each field's own source chip, BD/TDS expansion only, strength-change flag)
  - labs (report-range status only when the units match exactly)
  - dated timeline + undated bucket
  - attention (allergy recorded, penicillin/sulfa class exposure "for clinician review; current use unknown", identity withheld). Each item carries the weakest check state of its supporting facts and shows "⚠ based on a reading pending source check" when applicable
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
- `npx vitest run`: **50/50 pass** (synthetic inputs). Covered:
  - normalization, including Devanagari
  - the verifier: 25≠250, 12.5≠125, BD≠8D, 50mg=50 mg, missing quote, low confidence, unknown drug, other-person allergy, invalid boxes giving page-level evidence
  - dates (C06), identity (C11, label prefixes, age-only mismatch), "Tab Metoprolol" matching, lab ranges (C07, comparators, unit mismatch), urgent words
  - the brief: verbatim complaint, grouping and dating, pending visibility, pending marker on attention items, stable hashes, C13 staleness, C01 negation, withheld page, corrected answer
- `npm run build` (Next 16.4.0, Turbopack): pass.
- `npm run test:gate` against `next start` + PGlite: **22/22 pass** (`test-results/gate-report.json`):

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
| D1 | Mark reviewed → page 4 arrives | Allergy + "Amoxicillin (a penicillin) was prescribed 10 Sep 2026 · Clinic C" appear without clicking the banner, each marked "based on a reading pending source check"; attention stale; medicines/labs still reviewed; review event kept |
| D2 | Allergy source chip | Opens the history-note page with "Page-level evidence" and no highlight box |
| A1 | Doctor on D1, patient D4 presses help | Alert bar for D4 while on D1; kiosk shows "delivered" text before ack and "स्टाफ ने आपका अनुरोध देख लिया है" after; repeat press keeps 1 open alert; no "staff coming"; resume returns the kiosk to intake |
| A2 | Typed "अभी सीने में तेज दर्द हो रहा है।" | Paused, staff alert; completing while paused → 409 |
| A3 | Help while offline | Nearby-staff message; no delivered/ack text; 0 alerts before reconnect, 1 after retry + second press |
| U1 | Real kiosk gallery upload (`setInputFiles` → `createImageBitmap` → canvas JPEG) | Stored `image/jpeg`, 62,922 bytes; same photo uploaded again through the UI → still 1 page (compression was deterministic in Edge, so REPLAY of kiosk photos can match) |
| K1 | Skip papers, finish | Done message after save; no horizontal overflow at 390 px |
| V1 | Staff at 1366×768 and 768×1024 | No horizontal page overflow |

Screenshots (actual running screens) are in `test-results/screens/` (gitignored), including kiosk 390×844 start/tell/read-back/papers/check/done/help-delivered/help-acked/offline, staff 1366×768 brief/drawer/allergy-reveal/alert, and staff 768×1024. I inspected them: Devanagari shaping is correct and nothing is clipped in the inspected screens.

## Not run (do not claim these)
- Supabase Postgres (no `DATABASE_URL`). Concurrency was tested on PGlite, which serializes queries. The compare-and-swap logic (conditional update + unique `supersedes_id`) has **not** been exercised under real Postgres concurrency.
- Google Vision OCR, Claude page extraction, Claude transcript extraction: code paths compile against the installed SDK types (`messages.parse`, `zodOutputFormat`, `output_config.effort`) but have **never been called**. No latency, accuracy or schema-compile timings exist yet.
- Sarvam STT/TTS, the microphone, phone over HTTPS, Vercel deployment (including `after()` on Vercel), handwritten pages.
- Interrupted-claim recovery (`kickQueue` marking 3-minute-old claims failed) is implemented but untested: no test kills an invocation. `maxDuration = 120` assumes the Vercel plan allows it; check the project settings. Compression determinism was checked in desktop Edge only, not on the demo phone.
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

## 13 Oct ~16:45 IST: public demo, allergy guard, extraction fix
- **Public demo:** `https://internet-border-musical-meditation.trycloudflare.com/demo` (Cloudflare Quick Tunnel to `next start` on this laptop; the hostname changes if the tunnel restarts). Read-only, no login, scoped by a signed `parchi_demo` cookie to encounter D16 (`DEMO_ENCOUNTER_ALIAS`). Checked in fresh Edge contexts via the public URL at 1366×768 and 390×844: 6/6 thumbnails load, p4 drawer image + allergy reading load, 0 localhost requests, 0 errors, no overflow. With the demo cookie: D16 brief 200; D14 brief 401; D14 file 401; encounter list 401; doctor-review POST 401; no cookie 401. `/staff` still asks for the passcode.
- **D16 is fixture replay** (hand-authored readings, page-level evidence, labelled). D15 (duplicate, wrongly answered "पता नहीं") was deleted. Do not show D12: its page-4 allergy was stored as a documented negative; the brief now shows it in Attention as "mentioned (wording unclear)".
- **Root cause of the LIVE failures on the new pages (D17 p1–p3):** Qwen3-VL 4B ran away in `items[].ocr_line_ids` (0…366) until `num_predict` 1800 → `done_reason: length` → truncated JSON. Fix: `ocr_line_ids` `maxItems 3`. Re-run on U1 via `scripts/diag-extract.mts`: `done_reason: stop`, 388 tokens, 16 s, schema-valid, 4 items. **Not yet done:** retry D17 p1–p3 through the app, regression run on a proven fixture.
- Commands: `npx vitest run` 64/64; `npm run typecheck` pass; eslint clean; `npm run build` pass. The rehearsal script was not rerun.

## 13 Oct 17:09–17:45 IST: fresh LIVE proof pass (no voice)
- Start state: commit bb5b60f serving on :3000 behind the unchanged tunnel; DB copied to `.data/pglite-backup-1709-pass1` (copied while the server ran; `.data/pglite-backup-1013-before-cleanup` was taken with it stopped).
- **Before any change (prod, D19, LIVE):** U1 done (4 readings, 3 source-matched); U2 done with 0 readings; U3 failed "did not match the schema". Ollama observed loading qwen3-vl:4b-instruct (3.8 GB VRAM).
- **Diagnosis (`scripts/diag-extract.mts`, raw model output):** U3 `done_reason: length` at `num_predict` 1800, JSON cut mid-item 24 of ~28 (legitimately long, not a runaway). U2 schema-valid, but all 5 items `subject: other_person, assertion: denied` → held back by the verifier.
- **Fixes (bf6cf61):** `num_predict` 3600 (prompt ~2000 + 3600 fits `num_ctx` 6144, unchanged); verifier absence regex had a literal 0x08 instead of `\b` since 7a28204, so "not recorded"/"none" were never held back; `null` added; brief says "N AI readings were held back" instead of "no facts extracted"; `NEXT_DIST_DIR` for isolated builds.
- **Isolated test** (`.next-test` on :3001, fresh `.data/pglite-test`): U1 4 readings, U2 0 shown/5 held back, U3 done with 28 readings (19 matched). L4 (denied allergy, relative's Sulfa, embedded instruction): correct. L3 (ink-blotted strength): strength not matched (ok), Glimepiride/OD missing (recall).
- Unit 66/66, typecheck, lint, `next build` pass → prod now runs `NEXT_DIST_DIR=.next-live next start -p 3000`. Public /demo 200, D16 unchanged.
- **Video:** `tests/live/record-demo.ts` recorded `test-results/video/parchi-demo-LIVE-13Oct-1733IST.webm` (40 MB, ~3.7 min, gitignored) against prod, encounter D20, LIVE: typed complaint + read-back ok; 2 pages → brief ready 202 s after upload; source click 1 highlight box; nurse confirmed 1 reading. D20's lab page held back the literal "null" reaction (fix confirmed on fresh inference). The frames were **not** visually reviewed.
- **Voice:** not built. faster-whisper is installed, but the model weights are not cached (first use would download ~480 MB), and a real Hindi test needs a human speaker. User chose to skip.
- PPT: say "local OCR + local vision model, ~90 s per page on a laptop GPU", "voice planned", and that the public demo patient is replayed; do not claim voice or measured accuracy.
- MP4: `test-results/video/parchi-demo-LIVE-13Oct-1733IST.mp4` (H.264 1600x900, 3:55, 4.9 MB, converted with ffmpeg 7.1 from the imageio-ffmpeg wheel). Frames at the kiosk read-back, LIVE processing, brief, and nurse-queue steps were reviewed: captions and content as described.

## 13 Oct ~18:00–18:57 IST: UI polish, voice answers, new tunnel
- **UI polish (1dd1144):** brand tile, elevated cards (`shadow-card`/`shadow-lift` tokens), pill badges and chips, segmented Brief/queue control, accent-edged alert and queue cards, hover-lift page thumbnails, login card. Same layout and colours, no gradients.
- **Voice (1dd1144):** kiosk Record/Stop (auto-stop 25 s), cancel, local playback, send to `/api/kiosk/[token]/answers` (multipart), local faster-whisper small (CPU int8; weights downloaded today, ~480 MB) → read-back with सही है / बदलें / फिर से बोलें (supersedes, no duplicate). Kiosk state now includes answer `status`, so a clip still being transcribed shows "transcribing…" instead of a false "Transcript unavailable". Mic denied/missing/unsupported messages; tracks stopped on stop/cancel/unmount. Doctor: tag "transcript of recording · local Whisper"; original audio in the drawer, including superseded clips in history.
- **Measured:** `tests/live/voice-flow.ts` 8/8 on an isolated server and 8/8 through the public HTTPS URL (synthetic English SAPI clip via Chromium fake mic; 13–23 s send → transcript; ASR 5–11 s + translate 4–8 s). Spoken urgent words ("chest pain") pause intake and alert staff, same as typing. ASR error seen: "25 milligram" → "25 ml". Hindi not tested with a real speaker.
- **Deploy:** prod now `NEXT_DIST_DIR=.next-v3 next start -p 3000`. D17 and D19 deleted (backup `.data/pglite-backup-1836-before-d17-d19`). The voice test left two encounters, "Voice test" and "Voice denied test".
- **Tunnel:** the first quick tunnel (internet-border-musical-meditation) was dropped by Cloudflare (~13:23 UTC, control-stream failures; hostname NXDOMAIN). New tunnel: **https://irrigation-village-likewise-theft.trycloudflare.com/demo**, checked 10/10 rounds plus the fresh-browser demo check (desktop and phone, 6/6 thumbnails, drawer, 0 localhost requests). The submission must use the new URL.

## 14 Oct ~13:45 IST: cleanup and third tunnel
- Deleted the voice-test encounters D21/D22 (backup `.data/pglite-backup-1909-before-voice-tests`). Staff list: D16 (demo, replay), D18 (not ours), D20 (LIVE recording run).
- The second quick tunnel also died (QUIC control-stream failures from ~08:13 UTC; hostname NXDOMAIN), so both dead cloudflared processes were stopped. New tunnel over HTTP/2: **https://cheaper-tray-berlin-ethnic.trycloudflare.com/demo**. Checked 8/8 rounds plus the fresh-browser demo check (desktop and phone, 6/6 thumbnails, drawer, 0 localhost requests, /staff still asks for the passcode).
- Quick tunnels are not durable on this network. For anything longer-lived, use a named Cloudflare tunnel or a real deployment.
