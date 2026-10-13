# Milestone 3: the T01 clinician brief

Recommended: Sonnet 5.5 / high.

```text
Build the actual clinician summary from validated, attributed facts. Follow docs/UI_SPEC.md. Include complaint/uncertain duration, allergies and review concerns, prescribed versus patient-reported medicines, original lab values with units/ranges, the dated clinic/lab timeline and open issues. Keep the default brief concise enough for the one-screen target without hiding critical concerns.

Implement deterministic rules for missing onset, unidentified medicine, compatible medication-account differences, document identity, unknown dates and report-specific numeric ranges. Scope any allergy/medicine rule to the documented demo lookup and label historical or unknown exposure correctly. No diagnosis, dose advice, inferred after-food timing, current-use assumptions or invented confidence percentages.

Gate: upload documents out of order and show correct event-date ordering with an undated bucket. Every displayed clinical field opens the relevant evidence, including strength and frequency. The included negation, relative's allergy, unknown white pill, mismatched unit and ambiguous-date cases behave as specified. Inspect the running 1366x768 screen and fix clipping. Update HANDOFF.md.
```
