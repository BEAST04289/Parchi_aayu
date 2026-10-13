# Milestone 6: urgent assistance and truthful failures

Recommended: Sonnet 5.5 / high; review critical state handling with Opus / xhigh.

```text
Implement the manual help action first. Add only the narrow clinician-reviewed current-urgent-complaint triggers agreed for the synthetic demo. Treat this as assistance, never as validated triage or a safe-to-wait classifier. Include negation, temporality, ambiguity and ASR failure cases.

Pause intake, persist an idempotent staff alert, display actual delivery state and require a real staff acknowledgement. Show Staff acknowledged only after that action is stored. Acknowledgement is not clinical clearance; only explicit staff action resumes intake. On network failure, clearly tell the patient to approach nearby staff now.

Implement explicit LIVE, FIXTURE REPLAY and MANUAL modes. Keep input hashes and provider/model metadata. Replay may only load the matching known source. It must be visible and must never silently answer an unseen upload with a canned result. Retain original files when processing fails and offer retry/manual entry.

Gate: two-context alert/ack flow, disconnected request, denied microphone, failed OCR, duplicate retry and unknown replay file. Verify no false success state. Update HANDOFF.md.
```
