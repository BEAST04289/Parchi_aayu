> **Status (13 Oct ~11:30):** a working staff workspace exists in `components/staff/{StaffApp,BriefView,EvidenceDrawer,ui}.tsx` against the real API (no sample JSON needed): login with "Demo roles", rail, create encounter + QR, pinned brief with change banner, attention strip that updates immediately, Mark reviewed (sends displayed hashes), nurse queue with confirm/correct/unreadable (409 on stale), evidence drawer (page image, zoom, highlight boxes or page-level label; typed answer with history), global alert bar polling all encounters with delivered/ack/resume. Next for C: polish to the UI reference (medicine table density, ink crop in the queue, timeline), clip playback once B1 lands, timers, props and gold labels. Source files load from `/api/sources/[id]/file`, not signed URLs.

# C: Staff workspace (doctor + nurse), alerts, and all clinical content

You own:

- `app/staff/*`, `components/staff/*`
- `app/api/facts/[id]/review`, `app/api/encounters/[id]/doctor-review`, `app/api/alerts/[id]/*`
- print CSS

**Clinical duties (PLAN.md §7):**

- handwritten props
- `fixtures/gold-handwritten.json` (write it before seeing any model output)
- reviewing `data/drugs.json`, `data/allergy-classes.json`, `data/urgent-triggers.json` and the Hindi copy in `data/questions.json`
- the doctor persona in the demo

## C1 (H+0:45 → H+2:30): the doctor brief and evidence drawer

```text
Read CLAUDE.md, PLAN.md §3 and §6, docs/UI_SPEC.md (staff route), docs/Parchi_UI_Reference.pdf pages 2–3, lib/types.ts and fixtures/brief.sample.json. Build /staff against fixtures/brief.sample.json first (a single USE_SAMPLE flag), then switch to GET /api/encounters/[id]/brief when A's gate passes. Target the projector: 1366×768, readable from 3 metres (staff body 16px+, section titles 15–16px semibold, values 18px+).

Layout (match the UI reference):
- Header: parchi wordmark, "Staff workspace", mode badge LIVE / REPLAY (from encounter.mode, with a toggle to switch it via POST /api/encounters/[id]/mode), role chip, name, logout.
- Left rail 208px: encounters (alias, name/age, status, "N new" badge since last view), Create encounter (form → shows a large QR of kiosk_url + the URL), "SYNTHETIC DEMO" label.
- Brief: patient header (name, age, alias, coverage chip "p 5/6 read", "Snapshot N"); a reserved banner slot; ATTENTION strip (urgent = red with icon + word "Urgent"; allergy = red-tinted with "Allergy"; review = amber with "Check") — each item shows title, detail and source chips; REASON FOR VISIT (Hindi quote + English line + ▶ play answer chip); MEDICINES table (Medicine | Documented prescription | Patient reports) with flags as amber text lines under the row and the footnote "Identity must be confirmed in context. No instruction to change treatment."; RECENT LABS (≤3: value + unit, "Report range …", date, status word below/within/above or "not classified"); DATED HISTORY (last 4 dated events in a row + "+ earlier records" + an "Undated" bucket); OPEN QUESTIONS; VERIFICATION LEDGER footer ("18 lines · 18 sourced · 0 unsupported · 2 pending source check · 1 checked by nurse · 3 AI readings held back").
- Every clinical value carries its own source chip ([p3], [q2]); pending_check values render amber with "pending source check"; nurse-checked values show a small ✓ with name/time on hover/focus.

Evidence drawer (right side, 440px, focus-trapped, Esc closes):
- Page: GET /api/sources/[id]/evidence → image from signed_url with zoom (+ / − / fit, wheel/pinch) and highlight boxes drawn as absolutely positioned outlines at the anchor's normalized coordinates (they must scale with zoom). No boxes → full page and the label "Page-level evidence". Below: the exact quote, the interpreted value, check state and reasons, source label/clinic/date.
- Clip: <audio controls> with the signed URL, transcript_hi, English labelled "Sarvam translation" or "AI translation", and if corrected, the patient's corrected text plus the original. Opening another clip stops the previous one.
- Log click→image-loaded ms (for the evidence-open timer in C3).

Live updates: poll GET /api/encounters/[id]/rev every 2 s. On a new revision fetch the brief but DO NOT replace the rendered body: update the attention strip and alerts immediately; for everything else show the banner "New information: <changed sections> · Review changes". Clicking applies the new brief and outlines changed sections in teal for 2 s. Never move the reader's scroll position.

Gate: with the sample JSON, every chip opens the right drawer content; zoom keeps boxes aligned. Then with A's live API: upload fixtures/page-03.png from the kiosk → the medicine row appears via the banner, [p3] opens the page with the box on "Metoprolol 50 mg". Screenshot at 1366×768 and check no clipping. Record in HANDOFF.md.
```

## C2 (H+2:30 → H+4:30): nurse checks, doctor review, urgent alerts

```text
1. Nurse mode (role nurse): a "Needs source check" queue in the same workspace = facts with check_state pending_check from non-withheld sources + withheld pages. Each item: the ink crop (the page image scaled so the union box + 8% padding fills a 360×120 frame; full page if page-level), the proposed reading, the reason(s), and buttons Confirm reading / Correct / Unreadable. Correct requires an explicit value (numbers validated as numbers; units kept separate). Copy under the buttons: "Checking the source does not approve this medicine or dose."
   POST /api/facts/[id]/review {action, value?} (staff cookie supplies actor + role): if the fact's superseded_by is not null → 409 {message: "Already updated by <actor> at <time> — reload"}; else insert a new fact revision (same source, quote, anchor; value = new or same; check_state nurse_confirmed / nurse_corrected / unreadable; created_by actor; supersedes_id old id) and set old.superseded_by in the same request; insert an event {type: nurse_confirm|nurse_correct|nurse_unreadable, payload: {fact_id, old_value, new_value}}.
   Identity items: "This page names Sita, 34" → "It's Ramesh's" (identity confirmed_patient, facts released) / "Keep withheld". Logged as events.

2. Doctor mode: "Mark reviewed" in the patient header → POST /api/encounters/[id]/doctor-review stores {section_hashes, actor} as an event. Each section header then shows "Reviewed 11:42 · Dr Sharma" or, when its hash changes, amber "Changed since your review". The old review event stays in history (show a small history popover).

3. Alerts: when brief.alerts has an alert without acked_at → a full-width red bar at the very top of every staff view: "URGENT · D27 · patient said: '<quote>'" (or "Help requested from kiosk"), plus a chime (Web Audio beep; the login click unlocks audio) repeating every 10 s until acknowledged. On the first time the staff client sees it, call POST /api/alerts/[id]/delivered (sets delivered_at). Acknowledge → POST /api/alerts/[id]/ack (acked_at, acked_by + event). After ack, the bar turns calm with "Resume intake" → POST /api/alerts/[id]/resume (resumed_at, encounter.status back to intake + event). Nothing auto-clears.

Gate (two browsers + phone): nurse confirms one pending item and corrects another → the doctor screen gets the banner → after applying, values show the ✓ and the drawer shows the original reading in history; a double submit shows the 409 message. Doctor Mark reviewed → upload p4 on the kiosk → within ~2 s the allergy and amoxicillin lines appear in the attention strip without clicking; the attention section shows "Changed since your review"; medicines/labs stay "Reviewed". Kiosk urgent phrase → chime + bar → Acknowledge → the kiosk shows staff coming → Resume. Record results in HANDOFF.md.
```

## C3 (H+4:30 → H+5:30): 60-second polish, timers, print (only after checkpoint 2)

```text
1. Readability pass at 1366×768 against the UI reference: default view ≤ ~200 words; extra noncritical items collapse behind counts ("+2 more"); critical items never truncated; no tiny all-caps; contrast checked.
2. Timers in the ledger footer: kiosk intake time (intake_started_at → intake_completed_at) and median evidence-open time from the logged click→load measurements. Label both as measured in this session.
3. P2, only if everything else is rehearsed: @media print → a one-page "Parchi" (A5) with the brief, source labels, and a QR to /staff?e=<id> for evidence.
4. Phone check of /staff at 390px is NOT required (the projector is the target); just ensure nothing breaks at 1280px.
```
