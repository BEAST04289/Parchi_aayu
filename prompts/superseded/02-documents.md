# Milestone 2: real documents and source evidence

Recommended: Sonnet 5.5 / high. Use Opus / xhigh for a reproduced extraction/anchor bug.

```text
Read the current handoff. Implement the LIVE document path: image or bounded PDF upload, immutable sources with original page indices and hashes, OCR word boxes, one vision-model extraction pass with field-level evidence, schema validation and actual per-page states. Check current provider SDK documentation and keep credentials server-side. Use prompts/extraction-system.md.

Build the source drawer with actual source pages, zoom and correctly transformed OCR highlights. Fall back explicitly to page-level evidence when boxes cannot be validated. Preserve original numeric values, units, negation, patient identity, historical status and date precision. A dictionary proposes candidates and never silently changes a name or number. Rejected candidates produce visible unresolved issues/review items.

Gate: run an actual API request for a new document, open its correct source from a field, ingest the six-page PDF with page-four mapping intact, and prove that retry does not duplicate facts. Test a malformed response, provider timeout, mismatched identity and missing anchor. Record actual live outcomes separately from fixture tests. Update HANDOFF.md.
```
