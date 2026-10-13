> **Build-day note:** `PLAN.md` overrides this file wherever they conflict (simplified architecture, 6 tables, polling, no pairing codes/RLS/snapshot tables/PDF). Use `prompts/00-scaffold.md` then `prompts/A|B|C-*.md`; the old numbered prompts are in `prompts/superseded/`.

# UI implementation specification

The PDF beside this file is a visual reference, not a working app. Its fixtures and revision numbers are illustrative. Implement the behavior below rather than hardcoding the screenshot values.

## Visual system

Parchi should resemble a carefully designed clinic tool. Use a small wordmark, strong readable text, fine dividers and calm surfaces. The patient's interface can feel warmer than the staff workspace while sharing the same typography and colors.

| Token | Value |
| --- | --- |
| Page background | `#F6F7F4` |
| Surface | `#FFFFFF` |
| Primary text | `#153342` |
| Secondary text | `#526570` |
| Primary action | `#146C67` |
| Subtle teal surface | `#E8F3EF` |
| Border | `#D9E1DF` |
| Review/uncertainty text and background | `#80501B` / `#FFF3DC` |
| Urgent text and background | `#A32F35` / `#FCECEE` |
| Spacing | 4, 8, 12, 16, 24, 32, 48px |
| Corners | 10px ordinary surfaces, 12px patient controls |
| Typography | Inter or a system sans for English; Noto Sans Devanagari for Hindi; self-host the fonts |
| Body | Patient 20px with 1.5 line height; staff 16px with 1.45 line height |
| Titles | Patient 28–32px; staff 24–28px; summary section titles 15–16px semibold |

Verify actual text/background contrast after implementation. Use icons plus text, not color alone. Avoid tiny all-caps clinical labels, dense nested cards, a permanent chat bubble stream or a sidebar full of unused modules. Motion is limited to clear state transitions, roughly 120–180ms, with reduced-motion support. A waveform must reflect actual microphone input.

## Patient route: /patient/[encounterId]

Use a compact header, a central column up to 680px and a sticky bottom action area. The header has Parchi, language, encounter alias and a help action. A short stage indicator says "Tell us / Add papers / Check"; it must not show an invented completion percentage.

### 1. Start

Choose Hindi or English. Explain in one sentence that the information will be shown to the clinic staff before the visit. Ask consent to record voice separately from text participation. Voice is optional. A staff-created encounter provides identity; do not collect a long registration form again.

Visible help text: **"तबीयत बहुत खराब है? अभी स्टाफ को बताएं।"** Keep the help button reachable at every step. It works independently of successful transcription or document processing.

### 2. Tell us

Headline: **"आज आपको क्या परेशानी है?"**

Supporting text: **"बोलकर या लिखकर बताइए।"**

A large push-to-talk control starts recording only after permission. Clicking it again stops. Show elapsed time and the actual microphone signal. Initially cap at 25 seconds, below the speech endpoint's documented 30-second limit. Avoid silence auto-stop in the first build; a noisy OPD can trigger unreliable behavior. Release microphone tracks when recording ends or the user leaves.

Always show a full text alternative. If microphone permission fails, move focus to text input and explain the failure without blocking the encounter. Do not manufacture transcript words while recording; use "Recording" until a real response arrives.

After transcription show **"मैंने यह समझा:"**, the transcript, and **"सही है" / "बदलें" / "फिर से बोलें"**. A correction appends a new version. Original audio and transcript remain available to staff. Patient confirmation means the patient confirmed the account, not that it has been clinically verified.

### 3. Add papers

Camera and upload are equally visible. Display thumbnails with actual statuses: received, reading, readable, partly readable, needs retake, processing failed or identity check. Permit rotate, remove before submission, retry processing and retake. A camera blur heuristic is a hint, not a guarantee; allow upload with a warning when the patient cannot retake.

Show actual coverage, for example **"6 pages · 5 read · 1 needs retake"** only when those are the persisted states. Do not describe provider timeouts as bad photographs. Existing extracted facts remain visible while another page processes.

### 4. Clarify

One question at a time, chosen from active gaps. Example: **"आप पुरानी दवा ले रहे हैं या नए पर्चे वाली?"** It is allowed only when the papers support that question; never invent a drug name or strength to make it more specific.

Always offer **"पता नहीं"** and **"छोड़ें"**. Never ask a skipped topic again in the same encounter. Maximum three follow-ups. A short "Why we asked" explanation is optional and written plainly, such as "Two papers show different strengths."

Do not identify the "white tablet" from its color. Ask for packaging or mark the medicine unidentified. A patient may select an uploaded strip or read a printed name; the system still preserves the source and uncertainty.

### 5. Check and hand over

Show up to four short patient-facing lines: reason for visit, duration, medicines as reported and a concern they want the doctor to know. Each has Edit. Show unresolved items honestly and let the patient finish without answering everything. End with "Your information is ready for staff review" only after the save succeeds. Do not show "The doctor has reviewed" unless an actual review exists.

## Staff route: /staff

At 1366×768, use a 208px encounter rail and the remaining width for the brief. At smaller desktop sizes the rail collapses. At tablet size it becomes a drawer. Prioritize the doctor workspace at desktop width rather than shrinking it to unreadable mobile columns.

### Fixed hierarchy

1. **Patient header:** Ramesh, 52, encounter alias, current mode, coverage and snapshot revision.
2. **Attention strip:** urgent staff assistance, recorded allergy or other review concern. Distinguish urgent assistance from ordinary uncertainty with words as well as color.
3. **Reason for visit / patient's concern:** two concise lines with source and play controls where audio exists.
4. **Medicines:** compact table with Documented prescription / Patient reports / Open question. Avoid "Current medication" unless current use is actually established.
5. **Recent labs:** original value, unit, report range, date and source. No diagnosis paragraph.
6. **Dated timeline:** a compact vertical history or a short four-event row; an undated bucket is explicit. Clicking an event opens its source.
7. **Open questions and coverage:** visible gaps, withheld pages and review tasks.

Design the default summary for roughly 180–220 words, with full details in drawers. Critical concerns must never be truncated to meet the word budget. Additional noncritical items can collapse behind a count. Do not use tiny text to force a long record onto one screen.

### Source interactions

Each clinical field has a source action, not merely the entire medicine row. Clicking opens a 420–480px drawer with original page, zoom, page navigation, the evidence quote and the interpreted field. Highlight only valid OCR boxes transformed into the displayed image coordinates; show the full page and "Page-level evidence" if there is no valid region. Never highlight a plausible-looking nearby word.

For voice, show original transcript and an attributed English rendering. Play the real answer clip. Where genuine segment timestamps exist, allow segment playback labelled "phrase". Do not claim exact word timing. Stop previous audio when a new clip starts. Provide text for hearing accessibility; use headphones during a public demo.

### Nurse mode

The same workspace opens a "Needs source check" queue. Each item shows the original crop/page, proposed reading, reason for uncertainty and **Confirm reading / Correct / Unreadable**. Correction requires an explicit value and persists actor/time. Clinical resolution stays with an authorized clinician. Pending items are not hidden from the brief.

Use a real staff identity for actions. A doctor may also verify a source. A demo role switch can navigate seeded roles only in clearly identified demo mode; production permissions must not depend on that control.

### Changes while reading

Opening a brief pins its body to a snapshot. Nonurgent new information shows **"New information: medicines changed. Review changes"** in a reserved banner area. Clicking displays the changed fields with old/new attribution, then loads the new snapshot. Unchanged sections retain their prior review reference.

**Exception:** a newly recorded allergy or urgent staff alert immediately appears in the attention strip while preserving the pinned body and identifying its newer revision. A safety concern must not wait behind an ordinary update action. Do not silently replace the doctor's reading position.

### Failure states

- Empty encounter: useful upload/intake instructions, no fictional patient.
- Loading: stage label based on a real job state, no percentage unless measurable.
- Provider failure: retain original file/clip and offer retry or manual entry.
- Disconnected: show last sync time and disable claims that staff received a new request.
- Save conflict: keep the user's edit, explain newer source data and offer reapply after review.
- Source unavailable: show unavailable, retain attribution, never replace with an unrelated source.

## Visual acceptance

Capture actual running screens at 390×844, 768×1024 and 1366×768. Check Hindi glyph shaping, keyboard focus, overflow, contrast and source drawer readability. Test one-handed recording, a failed permission request, a long medicine name and a patient who answers "I don't know". The UI reference is a direction; the responsive running product is the acceptance target.
