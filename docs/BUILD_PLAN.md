> **Build-day note:** `PLAN.md` overrides this file wherever they conflict (simplified architecture, 6 tables, polling, no pairing codes/RLS/snapshot tables/PDF). Use `prompts/00-scaffold.md` then `prompts/A|B|C-*.md`; the old numbered prompts are in `prompts/superseded/`.

# Eight-hour build plan

Assumption: the original on-site eight-hour limit and a three-person team still apply. Follow the actual Round 2 rules if they differ. This handoff does not establish what code, assets or preparation the organizers permit before the event.

## Team ownership

| Person | Owns | Integration responsibility |
| --- | --- | --- |
| A | Domain, persistence, OCR/extraction, evidence validation, issue rules | Owns API contracts and the main integration branch |
| B | Patient UI, recording/transcription, adaptive questions, read-back | Tests real microphone/device behavior |
| C | Staff UI, source drawer, nurse review, version banner | Owns visual QA and stage rehearsal |

Share one fact contract before coding. Separate files by responsibility. Do not run two coding sessions editing the same schema or migration simultaneously. Use small commits after working milestones. Assign a human to review synthetic clinical content; coding models are not the clinical reviewer.

## Timeboxes and gates

| Time | Work | Exit evidence |
| --- | --- | --- |
| 0:00–0:30 | Freeze scope/schema, validate keys and one request per provider | Written contracts; actual provider smoke tests or named blockers |
| 0:30–2:00 | Patient text, shared encounter, staff brief and source drawer; document path in parallel | A typed complaint and one live page visible on the other device |
| 2:00–3:30 | Six-page ingestion, date timeline, original lab values, evidence validation | Correct source page/region opens; uncertain field stays flagged |
| 3:30–4:30 | Hindi clip, transcript read-back, one gap-driven question | Real audio plays on staff screen and correction persists |
| 4:30–5:30 | Nurse review, brief snapshots, stale-section logic, urgent handoff | Source correction/new allergy and request/acknowledgement flow work |
| 5:30–6:30 | Cross-device and edge-case tests, layout fixes | Core acceptance gates executed; failures resolved or scoped honestly |
| 6:30–8:00 | Freeze features, measure, rehearse twice, record backup | Known demo commit; matching backup video and honest replay mode |

This is aggressive. If the first real document path is not working by hour two, pause optional UI work and resolve it together. If the full scope slips, cut extras in this order: animation, print/export, segment seeking, advanced strip matching, extensive dictionaries, additional languages and elaborate timeline controls. Keep all four T01 requirements, source visibility, uncertainty and an honest failure path.

## Local-first rehearsal

Run the app locally in two browser contexts for the first integration check. For a phone/tablet demo, microphone capture needs a secure context; test the exact HTTPS deployment and device in advance. A plain LAN URL may not permit recording. The laptop loopback page is a fallback for the live recording demonstration, not evidence that arbitrary devices work.

Deployment, database quotas, upload limits, microphones and permissions are concrete rehearsal checks. Do not spend the last hour changing frameworks, providers or schemas. Cache only exact synthetic source results in a clearly labelled replay mode.
