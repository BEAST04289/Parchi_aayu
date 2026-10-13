# Milestone 8: challenge the prototype, then freeze

Recommended: Opus 5.5 / xhigh. Use max only for a bounded, reproduced issue that remains unresolved.

```text
Review this prototype against docs/ACCEPTANCE.md and the actual T01 requirements. Inspect code and run the app. Try to disprove that displayed fields are correctly attributed, that nurse verification differs from clinical review, that new evidence invalidates the correct section, and that urgent assistance states reflect real delivery/acknowledgement. Test authorization of source access and staff mutations, prompt injection in documents, replay/live separation and secret exposure.

Fix reproducible high-impact failures with the smallest changes. Do not redesign the app, swap providers or broaden scope. Run the relevant checks after each fix. Produce a compact report with observed pass/fail/not-run results, live provider evidence, dataset size, measured errors/abstentions, latency observations, current limitations and exact demo commit. Never fabricate metrics or describe fixtures as live results.

Complete the rehearsal, verify reset and fallback, update HANDOFF.md and freeze optional features. If an essential check remains blocked, clearly identify the blocker and the supported demo path rather than claiming completion.
```
