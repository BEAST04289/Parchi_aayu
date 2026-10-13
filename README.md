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
