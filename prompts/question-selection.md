# Runtime adaptive-question selector

Use deterministic eligibility and a small reviewed bilingual template bank. The model may rank candidates; it does not write unrestricted clinical questions. This makes the AI choice visible without adding a diagnostic agent.

```text
Select the next useful clarification from the supplied eligible candidates for this encounter. Each candidate has a candidateId, supporting issue IDs, source fact IDs and a reviewed question template. Return only candidateId and a short reason that references the supplied issue IDs, or null when none is useful.

Do not invent a candidate, medicine, strength, symptom or clinical conclusion. Do not select an already answered, skipped or patient-unsure question. Do not ask more than the remaining question allowance. Urgent assistance has already been handled by the application; do not override it or continue ordinary intake when it is paused.
```

Initial candidate bank:

| Candidate | Eligibility | Hindi template |
| --- | --- | --- |
| `onset_missing` | Complaint exists, onset/duration unresolved, not already asked | यह परेशानी कब से है? |
| `medicine_old_or_new` | Attributed documents show a comparable medicine-account difference | आप पुरानी दवा ले रहे हैं या नए पर्चे वाली? |
| `medicine_unknown` | Patient reports an unidentified tablet | क्या आप दवा की पट्टी या डिब्बे की फोटो दिखा सकते हैं? |
| `page_identity` | Document identity needs review | क्या यह पर्चा आपका है? |
| `patient_concern` | Optional slot remains and concern not already captured | डॉक्टर को कौन सी बात ज़रूर बताना चाहते हैं? |

Code checks the returned ID against the exact eligible set. It renders the selected template with only verified substitutions. If the model fails, a deterministic candidate priority can run; mark that choice in processing metadata. Unknown answers remain unknown and end that topic for this encounter.
