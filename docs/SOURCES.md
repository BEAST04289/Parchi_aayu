# Sources and limits

Checked 13 October 2026. The submitted eight-slide PowerPoint and the user-supplied T01 statement define the requested product. The references below support specific implementation or safety considerations; none validates Parchi as a clinical product.

1. **Claude Code model configuration.** Model selection and effort controls, including the 5.5 families and high/xhigh/max. Account/provider availability can differ. Model allocation in this kit is our engineering recommendation, not an Anthropic benchmark.
   https://code.claude.com/docs/en/model-config

2. **Claude Code best practices.** Explicit verification criteria, repository context and visual checking of UI changes.
   https://code.claude.com/docs/en/best-practices

3. **Sarvam STT REST API.** Short audio input, source/translation modes, optional phrase-level timestamps and supported formats. Timestamps are not word-level; language probability is not clinical or transcript accuracy.
   https://docs.sarvam.ai/api-reference/speech-to-text/transcribe

4. **Google Cloud Vision handwriting.** Document text extraction and OCR word/region information. Support for handwriting does not establish reliable reading of every Indian prescription.
   https://docs.cloud.google.com/vision/docs/handwriting

5. **Claude structured output and vision documentation.** Capabilities for image input and schema-constrained responses. Valid JSON does not guarantee factual or clinical correctness. Recheck the installed SDK's actual methods at implementation time.
   https://platform.claude.com/docs/en/build-with-claude/structured-outputs
   https://platform.claude.com/docs/en/build-with-claude/vision

6. **Supabase authorization, changes and storage.** RLS and private-source access are required design boundaries. The proposed encounter/session architecture is our implementation choice.
   https://supabase.com/docs/guides/database/postgres/row-level-security
   https://supabase.com/docs/guides/realtime/postgres-changes
   https://supabase.com/docs/guides/storage/buckets/fundamentals

7. **WHO IITT FAQ.** Clinical staff conduct triage; urgent assessment must not wait on administrative intake. The FAQ also distinguishes emergency-unit triage from screening in mostly stable outpatient populations. Parchi should not claim to implement or validate IITT.
   https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt-faq.pdf?sfvrsn=cc11cf12_5

8. **DailyMed amoxicillin label.** Supports a narrowly scoped penicillin/amoxicillin concern for clinician review. An allergy label with missing reaction details and a historical prescription is not enough to diagnose an allergy, infer current exposure, or advise treatment.
   https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=80a04b8a-110e-0aea-e053-2a91aa0ad057

The deck's population-level statistics, competitive exclusivity statement and extrapolated time savings were not adopted as evidence of prototype performance. Evaluate the actual demo instead. The synthetic packet contains invented people, clinics, dates and values; it is not a medical record or treatment recommendation.
