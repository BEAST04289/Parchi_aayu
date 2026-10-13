> **DONE (13 Oct, ~11:30). Do not paste this prompt again.** The scaffold exists in this repo and deviates on purpose: no Supabase Storage (blobs table + authenticated file route), `pg`/PGlite instead of supabase-js, `source_matched` instead of `verified`, citation-coverage ledger, revision without counters. `lib/types.ts` and `supabase/schema.sql` are the contract. See docs/HANDOFF.md.

# 00: Scaffold (one person, A, at H+0:00; target 40 minutes)

**Before pasting:**

1. Create an **empty** folder `C:\dev\parchi`. It must **not** be inside OneDrive.
2. Start Claude Code in that folder.
3. Don't copy anything in first, and don't run `git init`. `create-next-app` refuses a non-empty folder, and it initializes git itself.

The prompt copies the kit in afterwards.

Suggested Claude Code setting: Opus 5.5, effort `high`.

```text
This folder is empty. Step 0 creates the app and copies in our planning kit; after step 0, read CLAUDE.md and PLAN.md (sections 3 and 4) — they are binding. Then scaffold the Parchi app so three people can work in parallel from the next commit. Do not implement the AI pipeline, kiosk recording or nurse review yet; those belong to prompts A/B/C.

0. Run create-next-app in this empty folder non-interactively (check `npx create-next-app@latest --help` for current flags): latest stable Next.js, App Router, TypeScript, Tailwind, ESLint, no src/ dir, import alias @/*, npm. Then copy the planning kit from C:\Users\shaur\OneDrive\Desktop\Parchi_aayu\parchi-round2 into this folder (CLAUDE.md, PLAN.md, docs/, fixtures/, prompts/, data/, contracts/, .env.example), merging instead of overwriting: append the kit README under the Next.js README, keep the kit's variable names in .env.example, keep Next's .gitignore and make sure .env*.local is ignored. Now read CLAUDE.md and PLAN.md §3–4.

1. Install: @anthropic-ai/sdk zod @supabase/supabase-js qrcode @types/qrcode server-only clsx, and vitest as a dev dependency. Verify the installed Next.js version supports `after` from 'next/server'; note the result in docs/HANDOFF.md.

2. Fonts and tokens: next/font/google Inter and Noto_Sans_Devanagari (subsets latin + devanagari). Put the UI_SPEC colour tokens in CSS variables and the Tailwind theme: bg #F6F7F4, surface #FFFFFF, ink #153342, ink-2 #526570, teal #146C67, teal-soft #E8F3EF, line #D9E1DF, amber text #80501B on #FFF3DC, red text #A32F35 on #FCECEE. Radius 10px (staff), 12px (patient).

3. Write lib/types.ts with EXACTLY these shared contracts (fix only what the compiler requires; they are the contract between the three tracks):

export type Mode = 'live' | 'replay' | 'manual';
export type CheckState = 'verified' | 'pending_check' | 'nurse_confirmed' | 'nurse_corrected' | 'unreadable';
export type EvidenceKind = 'box' | 'page' | 'clip' | 'text';
export type SectionKey = 'attention' | 'reason' | 'medicines' | 'labs' | 'timeline' | 'open';
export type CandidateId = 'onset_missing' | 'medicine_old_or_new' | 'medicine_unknown' | 'page_identity' | 'patient_concern';
export interface DocDate { raw: string | null; iso: string | null; precision: 'day' | 'month' | 'year' | 'unknown'; assumed_dmy?: boolean }
export interface OcrWord { i: number; text: string; conf: number; box: [number, number, number, number] } // normalized 0..1 [left, top, right, bottom]
export interface OcrPage { text: string; words: OcrWord[] }
export interface Encounter { id: string; token: string; alias: string; patient_name: string; patient_age: number | null; patient_ref: string | null; language: 'hi' | 'en'; mode: Mode; status: 'intake' | 'paused_urgent' | 'ready'; intake_started_at: string | null; intake_completed_at: string | null; created_at: string }
export interface Source { id: string; encounter_id: string; kind: 'page' | 'clip' | 'typed'; seq: number; label: string; storage_path: string | null; mime: string | null; sha256: string | null; status: 'uploaded' | 'processing' | 'done' | 'failed'; error: string | null; readability: 'unknown' | 'readable' | 'partial' | 'unreadable'; identity: 'unchecked' | 'matched' | 'mismatch' | 'confirmed_patient' | 'withheld'; mode: Mode; model: string | null; timings: Record<string, number> | null; ocr: OcrPage | null; doc_type: 'prescription' | 'lab_report' | 'history_note' | 'other' | null; clinic: string | null; doc_date: DocDate | null; name_on_doc: string | null; width: number | null; height: number | null; question_id: string | null; transcript_hi: string | null; transcript_en: string | null; translation_by: 'sarvam' | 'claude' | null; duration_ms: number | null; supersedes_id: string | null; created_at: string }
export type FactKind = 'visit_reason' | 'complaint' | 'onset' | 'duration' | 'patient_concern' | 'med_name' | 'med_strength' | 'med_frequency' | 'med_form' | 'med_duration' | 'med_reported_taking' | 'allergy' | 'allergy_reaction' | 'lab_name' | 'lab_value' | 'lab_unit' | 'lab_range' | 'urgent_mention';
export interface Fact { id: string; encounter_id: string; source_id: string; group_key: string | null; kind: FactKind; value: string; value_en: string | null; quote: string | null; anchor: { boxes: [number, number, number, number][] } | null; evidence: EvidenceKind; check_state: CheckState; reasons: string[]; subject: 'patient' | 'other_person' | 'unknown'; assertion: 'present' | 'denied' | 'uncertain'; temporality: 'current' | 'historical' | 'unknown'; supersedes_id: string | null; superseded_by: string | null; created_by: string; created_at: string }
export interface Question { id: string; encounter_id: string; candidate_id: CandidateId; reason: string; fact_ids: string[]; state: 'asked' | 'answered' | 'unknown' | 'skipped'; answer_source_id: string | null; picked_by: 'claude' | 'priority'; created_at: string }
export interface AppEvent { id: string; encounter_id: string; actor: string; role: 'nurse' | 'doctor' | 'patient' | 'system'; type: string; payload: Record<string, unknown>; created_at: string }
export interface Alert { id: string; encounter_id: string; trigger: 'manual' | 'words'; quote: string | null; source_id: string | null; requested_at: string; delivered_at: string | null; acked_at: string | null; acked_by: string | null; resumed_at: string | null }
export interface Issue { id: string; rule_id: string; level: 'urgent' | 'allergy' | 'review' | 'info'; section: SectionKey; title: string; detail: string; fact_ids: string[]; source_labels: string[] }
export interface SourceRef { source_id: string; label: string; fact_ids: string[] }
export interface BriefLine { id: string; text: string; text_hi?: string; refs: SourceRef[]; check: CheckState | 'mixed'; origin: 'documented' | 'patient_reported' | 'staff' | 'rule' }
export interface MedRow { key: string; name: string; documented: { text: string; date_label: string | null; refs: SourceRef[]; check: CheckState | 'mixed' }[]; patient_reports: { text: string; quote_hi: string | null; refs: SourceRef[] } | null; flags: Issue[] }
export interface LabRow { key: string; name: string; value: string; unit: string | null; range: string | null; status: 'below' | 'within' | 'above' | 'unclassified'; date_label: string | null; refs: SourceRef[]; check: CheckState | 'mixed' }
export interface TimelineEvent { date_iso: string | null; date_label: string; title: string; refs: SourceRef[] }
export interface Ledger { lines: number; sourced: number; unsupported: number; pending_check: number; nurse_checked: number; held_back: number }
export interface Brief { encounter: Encounter; revision: string; counter: number; generated_at: string; coverage: { pages: number; read: number; pending: number; failed: number; withheld: number; clips: number }; attention: Issue[]; reason: BriefLine[]; medicines: MedRow[]; labs: LabRow[]; timeline: TimelineEvent[]; undated: TimelineEvent[]; open: BriefLine[]; ledger: Ledger; sections: Record<SectionKey, { hash: string; reviewed_at: string | null; reviewed_by: string | null; stale: boolean }>; alerts: Alert[]; timers: { intake_seconds: number | null } }

4. Write supabase/schema.sql (run manually in the Supabase SQL editor; print that instruction): tables encounters, sources, facts, questions, events, alerts, plus replays (sha256 text primary key, kind text, result jsonb, model text, recorded_at timestamptz). Columns mirror lib/types.ts (snake_case; jsonb for ocr, doc_date, timings, anchor, payload; text[] for reasons and fact_ids; uuid primary keys default gen_random_uuid(); timestamptz default now()). sources has unique(encounter_id, sha256). facts has a partial index on (encounter_id) where superseded_by is null. Include: insert into storage.buckets (id, name, public) values ('sources','sources', false) on conflict do nothing. No RLS policies (all access is server-side with the secret key; say so in a comment).

5. Server helpers (all import 'server-only'): lib/db.ts (Supabase client from NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY), lib/storage.ts (upload buffer, 300 s signed URL), lib/auth.ts (staff: STAFF_PASSCODE → httpOnly cookie {name, role}; requireStaff(); kiosk: encounterByToken(token) → 404 if missing), lib/hash.ts (sha256 hex).

6. Working routes (minimal but real):
   POST /api/staff/login {passcode, name, role} · POST /api/staff/logout
   GET /api/encounters (staff) · POST /api/encounters (staff) {patient_name, patient_age, patient_ref} → creates token (crypto random, 22+ chars base64url) and alias D{n} → returns {id, alias, kiosk_url}
   GET /api/encounters/[id]/brief (staff) → calls buildBrief() from lib/brief/build.ts. For now buildBrief returns a valid empty Brief built from real DB rows (sources/facts listed, empty sections). Prompt A fills it in.
   GET /api/encounters/[id]/rev (staff) → { revision, counter }: revision = sha1 of JSON.stringify(buildBrief(...)) with generated_at removed (so ANY change, including in-place updates like a failed page or an alert delivery, moves it); counter = facts + events count
   POST /api/encounters/[id]/mode (staff) {mode}
   GET /api/kiosk/[token]/state → { encounter: {alias, patient_name, language, status}, pages: [{id,label,status,readability,identity,error}], current_question, open_alert }
   Stubs that return 501 with a JSON message naming the owning prompt: POST /api/kiosk/[token]/pages (A), POST /api/kiosk/[token]/answers (B), POST /api/kiosk/[token]/questions/next (B), POST /api/kiosk/[token]/help (B), POST /api/facts/[id]/review (C), POST /api/encounters/[id]/doctor-review (C), POST /api/alerts/[id]/ack (C), GET /api/sources/[id]/evidence (A).

7. Pages: / → redirect /staff. /staff → login gate (passcode, name, role select labelled "Demo roles") then a shell: 208px encounter rail with Create encounter (shows QR of kiosk_url using the qrcode package + the URL) and an empty brief area. /k/[token] → patient shell: header (parchi wordmark, alias, Hindi/English toggle, help link text "तबीयत बहुत खराब है? अभी स्टाफ को बताएं।"), stage indicator "1 पर्चे जोड़ें · 2 बताइए · 3 जाँचें" (papers first, so pages are being read while the patient speaks), placeholder body. Hindi renders in Noto Sans Devanagari.

8. fixtures/brief.sample.json: a complete Brief object for the Ramesh story (PLAN.md §6 after page 4: penicillin allergy + amoxicillin class exposure in attention; metoprolol rows 25 mg p1 and 50 mg p3 with patient report "पुरानी 25 मिलीग्राम वाली" from q2 and flag strength changed / reported differs; amoxicillin 500 mg TDS historical p5; labs Hb 12.9 g/dL below 13.0–17.0 p2 and creatinine 1.1 mg/dL within 0.7–1.3 p6; timeline 14 Aug (p1,p4), 02 Sep, 04 Sep, 10 Sep, 12 Sep; one pending_check fact; ledger; one un-acked alert = null). Use fake but consistent UUIDs. Prompt C builds the staff UI against this file.

9. vercel.json {"regions": ["bom1"]}. Update .env.example: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY, PARCHI_MODEL=claude-opus-5-5, PARCHI_EFFORT=medium, GOOGLE_VISION_API_KEY, GOOGLE_CREDENTIALS_JSON (optional), SARVAM_API_KEY, STAFF_PASSCODE, NEXT_PUBLIC_APP_URL. .env.local is gitignored.

10. package.json scripts: dev, build, start, lint, typecheck (tsc --noEmit), test (vitest run).

Gate: npm run build and npm run typecheck pass. With .env.local filled and schema.sql applied: log in to /staff, create an encounter, open its kiosk URL in a second browser profile, refresh both, and confirm that the encounter persists and that a wrong token returns 404. Commit as "scaffold: shared contracts, schema, shells". Then print the exact steps for pushing to GitHub and importing to Vercel (env vars, region bom1). Update docs/HANDOFF.md with what you ran and saw.
```

**After this commit:** B and C pull and start their prompts. A pushes, imports the repo into Vercel (dashboard → Add New → Project), pastes the env vars and deploys. Then A opens the deployed `/k/...` URL **on the demo phone** to confirm that HTTPS and the microphone permission prompt work there.
