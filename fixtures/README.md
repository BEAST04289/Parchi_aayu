# Synthetic fixtures

All people, clinics and clinical values in this folder are invented. These are software test records, not prescriptions for use.

- `Parchi_Synthetic_Packet.pdf`: the six-page original packet.
- `page-01.png` through `page-06.png`: exact page renders for photo-style upload testing. These remain clean typeset images, not photographs or handwriting.
- `packet.json`: source text, dates, voice scripts and expected timeline.
- `gold.json`: expected extracted fields and original supporting quotes. This is a ground-truth proposal, not an accuracy report.
- `cases.json`: edge-case inputs and expected behavior.
- `manifest.json`: page hashes for exact fixture identity; do not use hashes to disguise replay as live extraction.

For the main stage sequence, upload pages 1, 2, 3, 5 and 6 first. Add page 4 later to test new evidence after review. Page four is a history note, not a lab report. Keep its original packet page identity if uploading it separately.

Handwrite additional synthetic records and photograph them on the actual demo device. Keep the original intended text and have a medical teammate review it. Use a naturally ambiguous sample for the nurse queue; do not secretly force a live model to make an error. Test blurred photography and provider outages as different failure modes. Record the Hindi scripts with a consenting teammate; no prerecorded audio is included here.
