# Milestone 4: Hindi intake that listens and asks a useful question

Recommended: Sonnet 5.5 / high.

```text
Implement real push-to-talk recording with MIME feature detection, a 25-second cap, elapsed time and a waveform based on microphone input. Provide text fallback and correctly release audio resources. Upload one answer clip per question, call Sarvam through the server and preserve the original transcript. Render patient read-back with confirm, edit and rerecord; corrections append new versions.

Staff must play the exact stored answer and view its original transcript. Use phrase timestamps only when actually returned and validated; otherwise play the whole answer. Keep English rendering separate from source-language quote evidence. Do not use language-detection probability as transcription accuracy.

Implement bounded adaptive selection using prompts/question-selection.md. Candidate questions come from active unresolved issues, not from free-form diagnostic reasoning. Ask up to three, suppress already answered/skipped topics and permit Pata nahi/skip. Do not identify a white tablet from appearance.

Gate: a teammate speaks an unseeded short Hindi answer, corrects it, and another browser plays the original clip and sees the correction. Missing-onset and already-known-onset cases produce different question behavior. Permission denial, empty audio and provider failure remain usable through text. Update HANDOFF.md with which live device/browser was tested.
```
