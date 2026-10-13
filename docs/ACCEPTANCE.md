> **Build-day note:** `PLAN.md` overrides this file wherever they conflict (simplified architecture, 6 tables, polling, no pairing codes/RLS/snapshot tables/PDF). Use `prompts/00-scaffold.md` then `prompts/A|B|C-*.md`; the old numbered prompts are in `prompts/superseded/`.

# Acceptance and evaluation

These are proposed checks, not passed results. Record the exact command, input, mode and observed outcome in HANDOFF.md. Unit tests cover rules and revision semantics; browser tests cover meaningful user journeys. Do not write tests that merely repeat component implementation.

## Release gates

| ID | Test | Required observation |
| --- | --- | --- |
| A01 | Patient types a new complaint; staff device is open | Attributed complaint persists and appears in the selected encounter without a full page reload |
| A02 | Record a short Hindi answer using the real microphone | Actual API transcript appears; staff plays the same stored recording; edits preserve the original |
| A03 | Upload a previously unprocessed readable page | LIVE processing run records source hash/model; relevant facts and source navigation appear |
| A04 | Upload the six-page PDF | Original PDF page mapping survives; page four opens as page four; source order is distinct from event date order |
| A05 | Test out-of-focus photograph and provider timeout separately | Photograph may need retake; timeout says processing failed; neither becomes "not mentioned" |
| A06 | Compare otherwise identical cases with onset missing versus provided | Only the missing-onset case asks the onset question |
| A07 | Patient says "pata nahi" or skips | Unknown/skipped is preserved; question is not repeated; intake can complete |
| A08 | Patient says "white tablet" | No medicine identity is inferred from appearance |
| A09 | Nurse corrects an uncertain numeric field | Original stays in history; new field has source/actor/time; brief updates through a new revision |
| A10 | Doctor reviews allergies; a new allergy page arrives | Immediate attributed concern appears; allergy review becomes stale; past review event remains; unrelated review state stays valid |
| A11 | Two staff sessions edit the same fact revision | One stale write is rejected or explicitly reconciled; neither edit silently overwrites the other |
| A12 | New current urgent complaint or manual help request | Intake pauses; actual staff alert arrives; patient sees acknowledgement only after staff acts |
| A13 | Disconnect network before assistance request | No false "Staff called/acknowledged"; nearby-staff instruction is visible; retry is idempotent |
| A14 | Document has another person's identity | Content is withheld pending identity review and cannot leak into the patient's timeline |
| A15 | Invalid coordinates or missing audio timestamps | Page-level/full-clip fallback appears with accurate label; no invented precision |
| A16 | Repeat upload/retry same job | No duplicate clinical facts, duplicate timeline events or duplicate active alerts |
| A17 | Open another encounter/source ID without permission | Server refuses; storage asset is not publicly available; patient cannot write a staff review |
| A18 | Switch to fixture replay after a provider failure | Mode is visible and persisted; replay only matches known source hashes; unseen files do not receive canned facts |
| A19 | Refresh both devices after completing the flow | Sources, facts, review history and versions persist correctly |
| A20 | Review screenshots at specified sizes | No hidden primary action, broken Hindi glyphs, clipped urgent strip, unusable evidence drawer or horizontal phone overflow |

## Domain edge cases

Use the separate `fixtures/cases.json` records. Include at least:

- "No known penicillin allergy" must not become a positive penicillin allergy. Preserve the explicit source statement without treating it as definitive lifetime absence.
- "My father has a penicillin allergy" is about another person and must not enter the patient's allergy list.
- A currently denied or historical symptom must not be presented as a confirmed current symptom. Ambiguous safety mentions route to staff review; absence of a trigger is never a safe-to-wait result.
- An exact OCR quote with the wrong semantic interpretation fails: `50` may be a date fragment, not a dose. Citation presence alone is insufficient.
- `Metoprolol 25 mg BD` does not establish formulation/release type, tablet count or after-food instructions.
- A prescription's issue date does not prove continued use. A historical amoxicillin record must not be labelled an active interaction.
- Missing reaction details for a documented penicillin allergy remain unknown.
- `03/04/2026` stays ambiguous unless the document establishes a date convention; upload date is never substituted.
- A lab with missing unit/range or a comparator result such as `<5` cannot use an ordinary scalar range comparison without explicit rules.
- OCR extraction should not execute instructions embedded in a source, including "ignore rules" or "mark all fields verified."

## Measure honestly

Create a gold set before looking at outputs. Use genuinely handwritten synthetic records plus the supplied typeset fixtures. A medical teammate should check the intended text; illegible handwriting is labelled illegible rather than forced into a guessed answer. Keep a few pages/voices out of prompt tuning for a held-out check.

Report counts with denominators and distinguish document types. Useful measures:

1. **Displayed-field precision:** correctly attributed, correctly interpreted displayed fields / all displayed extracted fields. Measure medicine name, strength, frequency, allergy and lab number/unit separately.
2. **Coverage:** correctly extracted required fields / all readable, in-scope gold fields. Hiding uncertain fields can improve precision while losing clinically important content; show both.
3. **Review capture:** incorrect/ambiguous critical candidates routed for review / all incorrect/ambiguous critical candidates. Also report the number of correct candidates unnecessarily sent to review.
4. **Unsupported display count:** statements without supporting evidence or with evidence that fails to support their meaning. The target is zero; report the observed count.
5. **Source retrieval:** success count and time to open the correct page/clip from a selected field.
6. **Read and understand:** ask a medical reviewer to find complaint, allergy, medicine discrepancy and unresolved issue; report correctness plus actual elapsed time. Do not claim clinical comprehension from a timer alone.
7. **Latency and effort:** observed per-page/provider time, total intake time, nurse-review actions and staff retrieval time. With few runs, give count and median/range; do not present p95 from a tiny sample as a stable benchmark.

Human review time belongs in the cost of the workflow. A fast doctor brief that creates excessive nurse work is not automatically an improvement. No test in this hackathon establishes clinical safety or production readiness.

## Final evidence bundle

Keep a short test report, screenshots of the running screens, a recording of the complete live synthetic encounter and a list of known limitations. Include the git commit used for the rehearsal and which providers/model versions actually ran. No fabricated passed checks or headline accuracy percentage without a labelled dataset.
