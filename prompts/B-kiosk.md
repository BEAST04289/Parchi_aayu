> **Status (13 Oct ~11:30):** the kiosk shell exists in `components/kiosk/Kiosk.tsx`: start -> typed answer with read-back and correction (append-only) -> papers (camera + gallery, on-device compression, persisted per-page status, retry, skippable) -> check -> done; help on every screen; urgent pause with requested/delivered/acknowledged states and an offline nearby-staff message. Typed-answer route + deterministic urgent check + transcript extraction (`lib/speech/answer.ts`, runs when ANTHROPIC_API_KEY is set) exist. Next for B: B1 voice (MediaRecorder, Sarvam STT, the multipart branch of the answers route that currently returns 501), then B2 questions. After acknowledgement the copy is "स्टाफ ने आपका अनुरोध देख लिया है", never "staff are coming".

# B: Patient kiosk, voice, questions, urgent help

You own:

- `app/k/*`, `components/kiosk/*`, `lib/speech/*`, `lib/questions/pick.ts`
- `app/api/kiosk/[token]/answers/*`, `app/api/kiosk/[token]/questions/*`, `app/api/kiosk/[token]/help`, `app/api/kiosk/[token]/complete`
- `scripts/gen-tts.ts`, `public/audio/*`

Test on the **real demo phone** over the deployed HTTPS URL. A plain LAN `http://` URL will not get microphone permission.

## B1 (H+0:45 → H+2:30): Hindi voice intake with read-back, photos

```text
Read CLAUDE.md, PLAN.md §2–3 and §6, docs/UI_SPEC.md (patient route), data/questions.json, data/urgent-triggers.json, prompts/extraction-system.md (transcript section) and lib/types.ts. Build /k/[token] as a calm Hindi-first, one-task-per-screen flow (central column ≤680px, sticky bottom actions, primary buttons ≥56px, Devanagari text 20px+). Screen order: Start → पर्चे जोड़ें (add papers; "मेरे पास पर्चे नहीं हैं" skips it) → बताइए (tell us) → questions → जाँचें (check). Papers come first so they are being read while the patient speaks; the numbered steps below describe each screen, not the order.

1. Start screen: language (हिंदी default / English), the consent sentence from data/questions.json, a separate optional voice-recording consent. Set intake_started_at on first action.

2. Tell-us screen: "आज आपको क्या परेशानी है?" + "बोलकर या लिखकर बताइए।" + a ▶ button that plays /audio/complaint.mp3 (pre-generated in B2; hide the button if the file is missing). Push-to-talk: tap to start (getUserMedia only now), tap again to stop; 25 s cap with a visible countdown; level meter from a real AnalyserNode (no decorative waveform); MediaRecorder MIME detection in order audio/webm;codecs=opus, audio/mp4, audio/ogg; stop and release all tracks on stop/unmount. While uploading show "सुन रहे हैं…" (no fake words). Text box always visible underneath ("अपनी बात यहाँ लिखें…") — same pipeline.

3. POST /api/kiosk/[token]/answers (multipart: audio OR text, optional question_id). maxDuration 60. Server:
   a. Store the clip (sources kind 'clip', label q{n}) or text (kind 'typed').
   b. Sarvam STT (lib/speech/sarvam.ts): POST https://api.sarvam.ai/speech-to-text, header api-subscription-key, model saaras:v4, language_code hi-IN, mode transcribe → transcript_hi. In parallel mode translate → transcript_en (translation_by 'sarvam'). If translate mode is rejected (smoke test result in HANDOFF.md), translate with Claude and set translation_by 'claude'.
   c. URGENT CHECK FIRST (lib/speech/urgent.ts): normalized transcript (and typed text) against data/urgent-triggers.json phrases. On hit: create an alert (trigger 'words', quote = matched phrase, idempotent: one open alert per encounter), set encounter.status 'paused_urgent', still store the source and run extraction, respond {paused: true}.
   d. Claude transcript extraction (lib/speech/extract.ts): input transcript_hi + the question being answered (text + candidate id + any document details shown with it). Output items {kind, value, value_en, quote, subject, assertion, temporality}; quote must be copied from transcript_hi. Verify: normalized quote found in transcript → verified with evidence 'clip' (or 'text' for typed); else pending_check. A white/colour-only tablet is never a med_name (C04). If the patient only says "पुरानी वाली" to a question that showed strengths, record med_reported_taking with value "older 25 mg (in answer to question showing 25 mg and 50 mg)" — keep the question context (C17).
   e. Failure → keep the clip, return a readable error; the kiosk shows "सुनने में दिक्कत हुई — फिर से बोलें या लिखकर बताइए". Never fabricate a transcript.

4. Read-back: "मैंने यह समझा:" + transcript_hi (large) + English (small, labelled) + buttons सही है / बदलें / फिर से बोलें. बदलें opens a prefilled textarea; saving creates a 'typed' source with supersedes_id = the clip source, re-runs extraction on the corrected text, and supersedes the old facts from that answer (append-only). The original clip and transcript stay available to staff.

5. Add-papers screen: "अपने पर्चे और रिपोर्ट की फोटो लीजिए।" Two equal buttons: फोटो लें (input type=file accept=image/* capture=environment) and गैलरी से चुनें (no capture, multiple). Before upload, compress in the browser: createImageBitmap(file, {imageOrientation: 'from-image'}) → canvas long side ≤1600 → JPEG 0.85. POST to /api/kiosk/[token]/pages (owned by A). Thumbnails show persisted states polled from /api/kiosk/[token]/state every 2 s: भेजा गया / पढ़ा जा रहा है / पढ़ लिया / कुछ हिस्सा पढ़ा / दोबारा फोटो लें / नहीं हो पाया (retry button → A's retry route) / पहचान जाँच. Coverage line only from persisted states, e.g. "5 पन्ने · 4 पढ़ लिए · 1 पढ़ा जा रहा है". Provider failure is never described as a bad photo.

6. Help button in the header on EVERY screen (text: "तबीयत बहुत खराब है? अभी स्टाफ को बताएं।"). POST /api/kiosk/[token]/help creates/returns the single open alert (trigger 'manual'). If the request fails or the device is offline, show "नेटवर्क नहीं है — कृपया पास के स्टाफ को अभी बताएं।" with a retry button; never show that staff were called.

Gate (on the phone, deployed URL): speak "आज पुराने पर्चे और रिपोर्ट दिखाने आया हूँ। दवा का नाम याद नहीं है। सफेद गोली लेता हूँ।" → read-back shows the real transcript; बदलें persists a correction; facts exist with quotes; no med_name was created from "सफेद गोली". Deny the mic permission → focus moves to the text box with an explanation. Upload a photo → compressed size logged under 1 MB, status reaches पढ़ लिया. Record device/browser/MIME/latency results in docs/HANDOFF.md.
```

## B2 (H+2:30 → H+4:30): gap-driven questions, spoken prompts, urgent pause, check screen

```text
1. scripts/gen-tts.ts (run with tsx): for every entry in data/questions.json with an audio filename, call Sarvam TTS (POST https://api.sarvam.ai/text-to-speech, header api-subscription-key, JSON {text, language_code: "hi-IN", model: "bulbul:v3", speaker from the file, output_audio_codec: "mp3"}) and write base64-decoded audios[0] to public/audio/<file>. If the speaker is rejected, omit it (default voice). Commit the generated files. Kiosk: each question screen plays its audio once after the user's first tap (browser autoplay rules) and shows a ▶ replay button.

2. POST /api/kiosk/[token]/questions/next: eligible = eligibleQuestions() from lib/questions/eligible.ts (A). If A hasn't merged it yet, write a temporary local version with the same signature and remove it after merge. If eligible is empty or 3 questions were already asked → {done: true}. Otherwise Claude picks (lib/questions/pick.ts, effort low, zod {candidate_id, reason}) from the eligible list given the issues' plain reasons; validate candidate_id ∈ eligible, else use the first eligible (picked_by 'priority'). Insert a questions row (state asked, reason, fact_ids). Respond with the template text (hi/en), audio file and any VERIFIED details to show beneath it (e.g. for medicine_old_or_new: "पर्चों में: 25 mg (14 Aug) · 50 mg (04 Sep)" built only from verified/nurse-confirmed facts).

3. Question screen: question text + audio + details + the same record/type UI + पता नहीं + छोड़ें. पता नहीं/छोड़ें → POST /api/kiosk/[token]/questions/[id]/respond {state: 'unknown'|'skipped'}; the topic is never asked again. An answer sets state 'answered' and answer_source_id. Flow: add papers → tell us → next question → … → check. A question that depends on documents only becomes eligible once its supporting pages are read; if nothing is eligible yet but pages are still reading, show "आपके पर्चे पढ़े जा रहे हैं…" and poll, then ask. A visit reason that is not a symptom ("पुराने पर्चे दिखाने आया हूँ") never triggers the onset question.

4. Urgent pause: when state.encounter.status = 'paused_urgent', show a full-screen calm view: "आपका अनुरोध दर्ज हो गया है।" (then "...स्टाफ की स्क्रीन पर पहुँच गया है" once delivered) + always-visible "अगर कोई तुरंत न आए, तो पास के स्टाफ को अभी बताएं।" Poll state; only when open_alert.acked_at is set show "स्टाफ आ रहे हैं — {acked_by}". Intake resumes only when staff sets resumed_at (C's button). Never show "safe" or "resolved".

5. Check screen: up to four lines the patient can edit (reason for visit, since when, medicines as reported, concern for the doctor) built from their own facts; unresolved items shown plainly; "पूरा करें" → POST /api/kiosk/[token]/complete sets intake_completed_at and status 'ready'; only after success show "आपकी जानकारी स्टाफ को भेज दी गई है। कृपया अपनी बारी का इंतज़ार करें।"

Gate: (1) typed complaint "पेट में जलन है" → onset question asked; a new encounter with "तीन दिन से पेट में जलन है" → not asked; "आज पुराने पर्चे और रिपोर्ट दिखाने आया हूँ" (visit reason, no symptom) → not asked. (2) After p1+p3 are processed → the old/new medicine question is asked with the 25/50 mg details; answer "मैं अभी पुरानी 25 मिलीग्राम वाली दवा ले रहा हूँ। नई दवा अभी खरीद नहीं पाया।" → a med_reported_taking fact with a quote. (3) पता नहीं stored and not re-asked. (4) "अभी सीने में तेज दर्द हो रहा है।" → kiosk pauses; ack via C's staff button (or curl) → kiosk shows acknowledged; resume works. (5) Phone in airplane mode → help shows the offline instruction. Record results in HANDOFF.md.
```

## B3 (H+4:30 → H+5:30): polish (only after checkpoint 2 passes)

```text
1. Blur hint: after capture, compute variance of a Laplacian on a 512px grayscale copy; calibrate the threshold on the demo phone with one sharp and one deliberately blurred photo; below threshold show "फोटो धुंधली लग रही है — दोबारा लें?" with दोबारा लें / फिर भी भेजें (never block).
2. Copy and layout pass on the phone at 390×844: no horizontal scroll, buttons reachable one-handed, Devanagari renders without broken matras, focus states visible, reduced motion respected.
3. Optional keyterms: when calling Sarvam for answers recorded after pages are processed, pass verified med_name values as keyterms (saaras:v4 only). Skip if short on time.
```
