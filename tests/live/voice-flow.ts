/**
 * Voice answer flow in real Edge with a fake microphone fed from a WAV file (Chromium flags), against a
 * running app: record -> stop -> local playback -> send -> local Whisper transcript read-back ->
 * re-record (supersedes, must not duplicate) -> confirm -> doctor brief tag + original audio in the
 * drawer. Also checks the microphone-denied message. The WAV is a TEST clip, not a patient recording.
 * Run: VOICE_BASE=http://localhost:3001 VOICE_WAV=path.wav npx tsx --env-file-if-exists=.env.local tests/live/voice-flow.ts
 */
import { chromium } from 'playwright-core';

const BASE = process.env.VOICE_BASE ?? 'http://localhost:3000';
const WAV = process.env.VOICE_WAV!;
const PASS = process.env.STAFF_PASSCODE!;
const results: { step: string; pass: boolean; note: string }[] = [];
const rec = (step: string, pass: boolean, note: string) => { results.push({ step, pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${step}: ${note}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the kiosk until a final transcript or a real failure; record whether a false failure ever flashed. */
async function waitResult(k: import('playwright-core').Page) {
  let sawTranscribing = false, falseFailure = false;
  for (let i = 0; i < 400; i++) {
    if (await k.getByTestId('transcribing').isVisible().catch(() => false)) sawTranscribing = true;
    const text = await k.getByTestId('readback-text').textContent({ timeout: 100 }).catch(() => null);
    if (text) return { text, sawTranscribing, falseFailure };
    if (await k.getByTestId('no-transcript').isVisible().catch(() => false)) {
      await sleep(4000); // a real failure stays; a false one is replaced by the transcript
      const later = await k.getByTestId('readback-text').textContent({ timeout: 100 }).catch(() => null);
      if (later) { falseFailure = true; return { text: later, sawTranscribing, falseFailure }; }
      return { text: null, sawTranscribing, falseFailure };
    }
    await sleep(250);
  }
  return { text: null, sawTranscribing, falseFailure };
}

async function main() {
  const login = await fetch(`${BASE}/api/staff/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: PASS, name: 'Sharma', role: 'doctor' }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const made = await (await fetch(`${BASE}/api/encounters`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ patient_name: 'Voice test', patient_age: 52 }) })).json();
  const kioskPath = new URL(made.kiosk_url).pathname;
  const encId = made.encounter.id as string;

  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'], baseURL: BASE });
  const k = await ctx.newPage();
  await k.goto(kioskPath);
  await k.getByRole('button', { name: 'शुरू करें' }).click();

  // 1. Record -> stop -> playback -> send.
  await k.getByTestId('rec-start').click();
  await k.getByTestId('rec-stop').waitFor();
  await sleep(6000);
  await k.getByTestId('rec-stop').click();
  await k.getByTestId('rec-playback').waitFor();
  const playable = await k.getByTestId('rec-playback').evaluate((a: HTMLAudioElement) => new Promise<boolean>((r) => { if (a.readyState >= 1) r(true); a.onloadedmetadata = () => r(true); a.onerror = () => r(false); setTimeout(() => r(a.readyState >= 1), 3000); }));
  rec('local playback before sending', playable, 'audio element loaded the recorded blob');
  const t0 = Date.now();
  await k.getByTestId('rec-send').click();
  const first = await waitResult(k);
  rec('send + local Whisper transcript', !!first.text && !first.falseFailure, `${Math.round((Date.now() - t0) / 1000)} s; transcribing shown=${first.sawTranscribing}; false "unavailable" flash=${first.falseFailure}; transcript: ${first.text ?? '(unavailable)'}`);

  // 2. Re-record supersedes the first clip (no duplicate answer).
  await k.getByTestId('rerecord').click();
  await k.getByTestId('rec-stop').waitFor();
  await sleep(4000);
  await k.getByTestId('rec-stop').click();
  await k.getByTestId('rec-send').click();
  const second = await waitResult(k);
  rec('re-recorded clip transcribed', !!second.text && !second.falseFailure, second.text ?? '(unavailable)');
  const st = await (await fetch(`${BASE}/api/kiosk/${kioskPath.split('/').pop()}/state`)).json() as { answers: { id: string; kind: string; supersedes_id: string | null }[] };
  const current = st.answers.filter((a) => !st.answers.some((b) => b.supersedes_id === a.id));
  rec('re-record does not duplicate', st.answers.length === 2 && current.length === 1 && current[0].kind === 'clip', `${st.answers.length} stored clips, ${current.length} current`);
  await k.getByRole('button', { name: 'सही है' }).click();
  await sleep(1500);

  // 3. Doctor: brief tag + original audio.
  const brief = await (await fetch(`${BASE}/api/encounters/${encId}/brief`, { headers: { cookie } })).json() as { reason: { refs: { source_id: string; label: string }[]; text_hi: string; check: string }[] };
  const line = brief.reason.find((l) => l.check === 'verbatim');
  const audio = line ? await fetch(`${BASE}/api/sources/${line.refs[0].source_id}/file`, { headers: { cookie } }) : null;
  rec('doctor brief shows the confirmed transcript', !!line && /^q\d/i.test(line.refs[0].label), `${line?.refs[0].label}: ${line?.text_hi}`);
  rec('doctor can fetch the original audio', audio?.status === 200 && /^audio\//.test(audio.headers.get('content-type') ?? ''), `${audio?.status} ${audio?.headers.get('content-type')} ${audio?.headers.get('content-length')} bytes`);
  const noAuth = line ? await fetch(`${BASE}/api/sources/${line.refs[0].source_id}/file`) : null;
  rec('audio needs a staff session', noAuth?.status === 401, `without cookie: ${noAuth?.status}`);

  // 4. Microphone denied (simulated by making getUserMedia reject, as a browser does on "Block").
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE });
  await ctx2.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
  const made2 = await (await fetch(`${BASE}/api/encounters`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ patient_name: 'Voice denied test', patient_age: 40 }) })).json();
  const k2 = await ctx2.newPage();
  await k2.goto(new URL(made2.kiosk_url).pathname);
  await k2.getByRole('button', { name: 'शुरू करें' }).click();
  await k2.getByTestId('rec-start').click();
  const msg = await k2.getByTestId('rec-error').textContent({ timeout: 5000 }).catch(() => null);
  const typingStill = await k2.getByTestId('answer-input').isVisible();
  rec('microphone denied message, typing still available', !!msg && typingStill, msg ?? 'no message');

  await browser.close();
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} voice checks passed`);
}

main().catch((e) => { console.error('VOICE FLOW FAILED:', (e as Error).message.split('\n')[0]); process.exit(1); });
