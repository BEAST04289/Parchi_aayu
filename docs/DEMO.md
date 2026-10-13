> **Build-day note:** `PLAN.md` overrides this file wherever they conflict (simplified architecture, 6 tables, polling, no pairing codes/RLS/snapshot tables/PDF). Use `prompts/00-scaffold.md` then `prompts/A|B|C-*.md`; the old numbered prompts are in `prompts/superseded/`.

# Stage demo

## Main story, about three minutes

Use a synthetic routine follow-up encounter for the full intake demonstration. This lets the audience see every T01 feature without suggesting that a patient with current chest pain should remain at a kiosk. Demonstrate current chest pain separately as the urgent interruption test.

Prepare the exact documents in `fixtures/`. The packet has prescriptions from three fictional clinics, two lab reports and a history note on page four. The typeset packet proves ingestion, dates and evidence navigation; add genuinely handwritten synthetic pages to demonstrate and measure handwriting separately.

| Time | Action | Narration |
| --- | --- | --- |
| 0:00–0:15 | Hold up the folder and open a fresh encounter | "Ramesh has papers from three clinics. Before the doctor sees him, Parchi brings the history together and keeps every source attached." |
| 0:15–0:45 | Upload pages 1, 2, 3, 5 and 6; speak the first Hindi answer while processing | "The patient can speak or type. The papers and the patient's account stay distinct." |
| 0:45–1:10 | Show the question about old versus new medicine; answer and confirm/correct transcript | "The question comes from a gap between the documents and what Ramesh actually knows." |
| 1:10–1:40 | Open staff brief, show original lab units and dated timeline; play the answer | "Here is his history on one screen. The doctor can hear the answer rather than trusting a paraphrase alone." |
| 1:40–2:00 | Resolve one genuine uncertain reading in the nurse drawer | "The nurse checks the ink. We log the correction; this does not approve the clinical regimen." |
| 2:00–2:30 | Add the history note from packet page four after the doctor has opened/reviewed the brief | "A new source records penicillin allergy. The concern appears immediately and the affected section needs review again." |
| 2:30–2:50 | Open the exact page-four line from the concern | "The doctor can inspect where it came from. Reaction details and present antibiotic use are still unknown." |
| 2:50–3:00 | Return to the concise brief | "Our goal is a 60-second read, with the patient's story and unresolved questions in view." |

Do not force an uncertainty error during a LIVE extraction just to make the story work. If the live handwriting is read correctly, show another genuinely ambiguous sample, or explicitly switch to the labelled uncertainty test fixture. The UI must not secretly hardcode an error or correction.

## Hindi rehearsal lines

Initial visit: **"आज पुराने पर्चे और रिपोर्ट दिखाने आया हूँ। दवा का नाम याद नहीं है। सफेद गोली लेता हूँ।"**

After seeing the supported medicine clarification: **"मैं अभी पुरानी 25 मिलीग्राम वाली दवा ले रहा हूँ। नई दवा अभी खरीद नहीं पाया।"**

Do not add frequency to the patient report unless they actually state it. The old prescription's BD is a separate documented field. Do not infer a confirmed medicine identity merely from the words "white tablet."

## Separate guardrail check, about 20–30 seconds

Start another encounter and say **"अभी सीने में तेज दर्द हो रहा है।"** The intake pauses and requests staff assistance. Show the actual staff alert. Have the staff actor acknowledge it; only then does the patient view say it was acknowledged. Say that this is a narrow safety demonstration, not automated triage. Do not show an automatic "safe" or "resolved" state.

If the request cannot be delivered, show the nearby-staff instruction. Do not rely on the assistant to contact emergency services.

## Two rehearsed variations

1. An unreadable photo: show retake/review and an unresolved item, not a guessed dose.
2. A new source after review: show the changed section and preserved review history.

Allow a judge to inspect another source or enter a different short answer. Do not promise arbitrary medical document coverage. Explain the tested limits if asked.

## Setup and reset

- One projector/browser for staff, one tablet/phone or second browser for the patient.
- A known working HTTPS origin, microphone permission, real provider keys and a small quota check.
- Use the current LIVE badge during live runs. Keep no real patient data in browser history or files.
- Reset creates a fresh encounter without deleting prior audit history; rehearse the reset button.
- Keep the brief in the right encounter and the source drawer closed at the start.
- Use headphones for voice playback in a shared room when possible.

## If the network fails

Announce the failure. Show text/manual behavior if available, or switch explicitly to **Fixture replay** for the prepared packet. Replay must identify the recorded inputs and outputs. A backup video should show a previously successful live synthetic run with the mode visible. Never describe replay as fresh AI processing.

## Likely judge questions

**Why not just use a general LLM?** A general model can perform many individual tasks. Our prototype adds shared patient/staff state, field-specific evidence, constrained questions, source review and revision-aware clinical reading. Demonstrate those differences instead of claiming exclusivity.

**What if the handwriting is wrong?** Show the uncertain item and correction history. Explain that OCR scores and quotation checks do not establish medical correctness.

**How much time does it save?** Present only the measured reviewer task results and their small sample size. The 60-second brief and intake time are targets until measured.

**Does this diagnose or change medicines?** It organizes reported and documented information. Clinical decisions remain with staff. A discrepancy is a question to resolve, not an instruction to change treatment.
