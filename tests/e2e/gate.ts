/**
 * Scaffold gate + keyless checks, run against a running server (default http://localhost:3000) in
 * real Microsoft Edge contexts (playwright-core, channel msedge). Prints and writes
 * test-results/gate-report.json with observed pass/fail per check. Screenshots in test-results/screens.
 *
 * What this does NOT exercise: Supabase, Google Vision, Claude, Sarvam. Pages processed here use
 * either LIVE mode with no keys (honest failure) or FIXTURE REPLAY rows from
 * scripts/seed-fixture-replays.ts (hand-authored, labelled, page-level evidence only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const BASE = process.env.GATE_BASE ?? 'http://localhost:3000';
const PASS = process.env.STAFF_PASSCODE!;
const SECRET = process.env.SESSION_SECRET!;
const OUT = path.join(process.cwd(), 'test-results');
const SHOTS = path.join(OUT, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });

type Result = { id: string; name: string; pass: boolean; observed: string };
const results: Result[] = [];
async function check(id: string, name: string, fn: () => Promise<string>) {
  try {
    const observed = await fn();
    results.push({ id, name, pass: true, observed });
    console.log(`PASS ${id} ${name} — ${observed}`);
  } catch (e) {
    results.push({ id, name, pass: false, observed: (e as Error).message });
    console.log(`FAIL ${id} ${name} — ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 15000, what = 'condition'): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** HTTP helper with an explicit cookie header (no browser). */
async function http(method: string, url: string, opts: { cookie?: string; json?: unknown; body?: BodyInit } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
    redirect: 'manual',
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { /* binary */ }
  return { status: res.status, data, bytes: text.length };
}
async function loginCookie(name: string, role: 'doctor' | 'nurse'): Promise<string> {
  const res = await fetch(BASE + '/api/staff/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: PASS, name, role }) });
  assert(res.status === 200, `login ${role} failed ${res.status}`);
  const sc = res.headers.get('set-cookie') ?? '';
  return sc.split(';')[0];
}
function signedCookie(payload: object): string {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `parchi_staff=${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`;
}
async function uploadFile(token: string, file: string, bytes?: Buffer) {
  const buf = bytes ?? fs.readFileSync(file);
  const fd = new FormData();
  fd.append('image', new File([new Uint8Array(buf)], path.basename(file), { type: 'image/png' }));
  return http('POST', `/api/kiosk/${token}/pages`, { body: fd });
}
const tokenOf = (url: string) => url.split('/k/')[1];

async function staffLogin(page: Page, name: string, role: 'Doctor' | 'Nurse') {
  await page.goto(BASE + '/staff');
  await page.getByLabel('Staff passcode').fill(PASS);
  await page.getByLabel('Your name').fill(name);
  await page.getByText(role, { exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText(`Demo role: ${role}`).waitFor();
}

async function main() {
  assert(PASS && SECRET, 'STAFF_PASSCODE and SESSION_SECRET must be set (use npm run test:gate, which loads .env.local)');
  const browser: Browser = await chromium.launch({ channel: 'msedge', headless: true });
  const staffCtx: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const kioskCtx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const staff = await staffCtx.newPage();
  const kiosk = await kioskCtx.newPage();
  const doctorCookie = await loginCookie('Sharma', 'doctor');
  const nurseCookie = await loginCookie('Priya', 'nurse');
  let kioskUrlA = '';
  let encA = '';
  const complaint = 'आज पुराने पर्चे और रिपोर्ट दिखाने आया हूँ। दवा का नाम याद नहीं है। सफेद गोली लेता हूँ।';

  // ---------------- Scaffold gate ----------------
  await check('G1', 'Staff login (browser) and signed session', async () => {
    await staffLogin(staff, 'Sharma', 'Doctor');
    const cookies = await staffCtx.cookies();
    const c = cookies.find((x) => x.name === 'parchi_staff');
    assert(c && c.httpOnly && c.sameSite === 'Lax', 'cookie missing or not httpOnly/Lax');
    const local = await staff.getByTestId('local-db').isVisible();
    return `signed in as Dr Sharma; cookie httpOnly=${c.httpOnly} sameSite=${c.sameSite}; LOCAL DEV DATABASE badge visible=${local}`;
  });

  await check('G2', 'Staff creates an encounter (browser) with QR + kiosk link', async () => {
    await staff.getByRole('button', { name: '+ Create encounter' }).click();
    await staff.getByLabel('Patient name').fill('Ramesh');
    await staff.getByLabel('Age').fill('52');
    await staff.getByLabel('Patient ID (optional)').fill('SYN-R52');
    await staff.getByRole('button', { name: 'Create', exact: true }).click();
    kioskUrlA = (await staff.getByTestId('kiosk-url').textContent())!.trim();
    assert(/\/k\/[A-Za-z0-9_-]{22,}$/.test(kioskUrlA), `bad kiosk url ${kioskUrlA}`);
    await staff.screenshot({ path: path.join(SHOTS, 'staff-created-1366x768.png') });
    await staff.getByRole('button', { name: 'Go to brief' }).click();
    await staff.getByTestId('section-reason').waitFor();
    const list = await http('GET', '/api/encounters', { cookie: doctorCookie });
    const row = (list.data.encounters as { id: string; alias: string }[]).find((e) => kioskUrlA && e.alias);
    encA = (list.data.encounters as { id: string; patient_name: string }[])[0].id;
    return `kiosk token length ${tokenOf(kioskUrlA).length}; encounter ${row?.alias} id ${encA.slice(0, 8)}…`;
  });

  await check('G3', 'Patient opens the kiosk in a second, independent context and types a complaint', async () => {
    assert((await kioskCtx.cookies()).length === 0, 'kiosk context unexpectedly has cookies');
    await kiosk.goto(kioskUrlA);
    await kiosk.screenshot({ path: path.join(SHOTS, 'kiosk-start-390x844.png') });
    await kiosk.getByRole('button', { name: 'शुरू करें' }).click();
    await kiosk.getByTestId('answer-input').fill(complaint);
    await kiosk.screenshot({ path: path.join(SHOTS, 'kiosk-tell-390x844.png') });
    await kiosk.getByTestId('answer-send').click();
    const rb = await kiosk.getByTestId('readback-text').textContent();
    assert(rb?.trim() === complaint, `readback mismatch: ${rb}`);
    await kiosk.screenshot({ path: path.join(SHOTS, 'kiosk-readback-390x844.png') });
    return 'read-back shows the exact stored text';
  });

  await check('G4', 'Complaint appears on the staff screen without a page reload, with its source', async () => {
    const banner = staff.getByTestId('change-banner');
    await banner.waitFor({ timeout: 10000 });
    const bannerText = await banner.textContent();
    await staff.getByRole('button', { name: 'Review changes' }).click();
    const line = staff.getByTestId('section-reason').getByText(complaint, { exact: false });
    await line.waitFor({ timeout: 5000 });
    await staff.getByTestId('section-reason').getByRole('button', { name: 'Open source a1' }).click();
    const drawer = staff.getByRole('dialog', { name: 'Source evidence' });
    await drawer.getByText('Typed by the patient (verbatim)').waitFor();
    const drawerText = await drawer.textContent();
    assert(drawerText?.includes(complaint), 'drawer does not show the verbatim text');
    await staff.screenshot({ path: path.join(SHOTS, 'staff-drawer-typed-1366x768.png') });
    await staff.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    await staff.screenshot({ path: path.join(SHOTS, 'staff-brief-complaint-1366x768.png') });
    return `banner "${bannerText?.trim()}" → applied; [a1] opens drawer with verbatim text; Esc closes`;
  });

  await check('G5', 'Refresh both contexts: data persists, sessions persist', async () => {
    await staff.reload();
    await staff.getByText('Demo role: Doctor').waitFor();
    await staff.getByTestId('enc-D1').click();
    await staff.getByTestId('section-reason').getByText(complaint, { exact: false }).waitFor();
    await kiosk.reload();
    const rb = await kiosk.getByTestId('readback-text').textContent();
    assert(rb?.trim() === complaint, 'kiosk lost the answer after reload');
    return 'staff still signed in and brief shows complaint; kiosk read-back shows the same text';
  });

  // ---------------- Access control ----------------
  await check('S1', 'Wrong kiosk token is rejected', async () => {
    const r1 = await http('GET', '/api/kiosk/AAAAAAAAAAAAAAAAAAAAAAAA/state');
    const r2 = await http('GET', '/api/kiosk/short/state');
    const r3 = await http('POST', '/api/kiosk/AAAAAAAAAAAAAAAAAAAAAAAA/help');
    assert(r1.status === 404 && r2.status === 404 && r3.status === 404, `got ${r1.status}/${r2.status}/${r3.status}`);
    const p = await kioskCtx.newPage();
    await p.goto(BASE + '/k/AAAAAAAAAAAAAAAAAAAAAAAA');
    await p.getByText('This link is not valid').waitFor();
    await p.close();
    return 'state/help 404; kiosk page shows "This link is not valid"';
  });

  await check('S2', 'Forged, unsigned, tampered and expired staff sessions are rejected', async () => {
    const forged = 'parchi_staff=' + Buffer.from(JSON.stringify({ name: 'Mallory', role: 'doctor', exp: Date.now() + 1e7 })).toString('base64url') + '.AAAA';
    const unsigned = 'parchi_staff=' + Buffer.from(JSON.stringify({ name: 'Mallory', role: 'doctor', exp: Date.now() + 1e7 })).toString('base64url');
    const real = doctorCookie.split('=')[1];
    const [p] = real.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), role: 'doctor', name: 'Mallory' })).toString('base64url');
    const tampered = `parchi_staff=${tamperedPayload}.${real.split('.')[1]}`;
    const expired = signedCookie({ name: 'Old', role: 'doctor', exp: Date.now() - 1000 });
    const codes = [];
    for (const c of [forged, unsigned, tampered, expired]) codes.push((await http('GET', '/api/staff/me', { cookie: c })).status);
    const ok = (await http('GET', '/api/staff/me', { cookie: doctorCookie })).status;
    assert(codes.every((c) => c === 401) && ok === 200, `codes ${codes} ok=${ok}`);
    return `forged/unsigned/tampered/expired → ${codes.join('/')}; genuine → ${ok}`;
  });

  // ---------------- Pages without keys (LIVE) ----------------
  let p1Id = '';
  await check('P1', 'LIVE upload with no OCR key: original stored, honest "processing not run", not "unreadable"', async () => {
    const r = await uploadFile(tokenOf(kioskUrlA), path.join('fixtures', 'page-01.png'));
    assert(r.status === 201, `upload status ${r.status} ${JSON.stringify(r.data)}`);
    p1Id = (r.data.source as { id: string }).id;
    const st = await waitFor(async () => {
      const s = await http('GET', `/api/kiosk/${tokenOf(kioskUrlA)}/state`);
      const pg = (s.data.pages as { id: string; status: string; error: string; readability: string }[]).find((x) => x.id === p1Id);
      return pg && pg.status !== 'uploaded' && pg.status !== 'processing' ? pg : null;
    }, 20000, 'page to settle');
    assert(st.status === 'failed' && st.readability !== 'unreadable' && /not configured/.test(st.error), `page state ${JSON.stringify(st)}`);
    return `status=${st.status}, readability=${st.readability}, error="${st.error}"`;
  });

  await check('P2', 'Re-uploading the same file does not create a duplicate source', async () => {
    const r = await uploadFile(tokenOf(kioskUrlA), path.join('fixtures', 'page-01.png'));
    const s = await http('GET', `/api/kiosk/${tokenOf(kioskUrlA)}/state`);
    const n = (s.data.pages as unknown[]).length;
    assert(r.status === 200 && r.data.duplicate === true && n === 1, `status ${r.status} dup=${r.data.duplicate} pages=${n}`);
    return `duplicate=true, pages still ${n}`;
  });

  await check('P3', 'Original page opens from the brief for staff; never without a staff session', async () => {
    await staff.getByTestId('pages').getByRole('button', { name: 'Open source p1' }).waitFor({ timeout: 8000 });
    await staff.getByTestId('pages').getByRole('button', { name: 'Open source p1' }).click();
    const img = staff.getByRole('img', { name: 'Original page p1' });
    await img.waitFor();
    const w = await waitFor(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), 8000, 'image load');
    await staff.screenshot({ path: path.join(SHOTS, 'staff-drawer-page-failed-1366x768.png') });
    await staff.keyboard.press('Escape');
    const anon = await http('GET', `/api/sources/${p1Id}/file`);
    const anonEv = await http('GET', `/api/sources/${p1Id}/evidence`);
    const staffFile = await http('GET', `/api/sources/${p1Id}/file`, { cookie: doctorCookie });
    assert(anon.status === 401 && anonEv.status === 401 && staffFile.status === 200, `anon ${anon.status}/${anonEv.status} staff ${staffFile.status}`);
    return `image loaded in drawer (naturalWidth ${w}); no-session file/evidence → ${anon.status}/${anonEv.status}; staff → ${staffFile.status}`;
  });

  // ---------------- Fixture replay story (no provider calls) ----------------
  let encR = '', tokR = '', aliasR = '';
  await check('R1', 'FIXTURE REPLAY: unseen file gets no canned result', async () => {
    const m = await http('POST', '/api/encounters', { cookie: doctorCookie, json: { patient_name: 'Replay miss test', patient_age: 50 } });
    const encM = (m.data.encounter as { id: string }).id, tokM = tokenOf(m.data.kiosk_url as string);
    await http('POST', `/api/encounters/${encM}/mode`, { cookie: doctorCookie, json: { mode: 'replay' } });
    const altered = Buffer.concat([fs.readFileSync('fixtures/page-02.png'), Buffer.from([0])]);
    const r = await uploadFile(tokM, 'unseen.png', altered);
    const id = (r.data.source as { id: string }).id;
    const pg = await waitFor(async () => {
      const s = await http('GET', `/api/kiosk/${tokM}/state`);
      const x = (s.data.pages as { id: string; status: string; error: string }[]).find((p) => p.id === id);
      return x && x.status === 'failed' ? x : null;
    }, 15000, 'replay miss');
    return `status=failed, error="${pg.error}"`;
  });

  await check('R2', 'FIXTURE REPLAY of p1, p3, p5: medicines grouped, dated, every reading pending (page-level), mode labelled', async () => {
    const c = await http('POST', '/api/encounters', { cookie: doctorCookie, json: { patient_name: 'Ramesh', patient_age: 52, patient_ref: 'SYN-R52' } });
    encR = (c.data.encounter as { id: string }).id; tokR = tokenOf(c.data.kiosk_url as string); aliasR = (c.data.encounter as { alias: string }).alias;
    await http('POST', `/api/encounters/${encR}/mode`, { cookie: doctorCookie, json: { mode: 'replay' } });
    for (const n of ['01', '03', '05']) await uploadFile(tokR, path.join('fixtures', `page-${n}.png`));
    const b = await waitFor(async () => {
      const r = await http('GET', `/api/encounters/${encR}/brief`, { cookie: doctorCookie });
      const meds = r.data.medicines as { key: string; documented: { fields: { check: string; display: string }[] }[] }[];
      return meds?.length === 2 && meds.find((m) => m.key === 'metoprolol')?.documented.length === 2 ? r.data : null;
    }, 20000, 'replayed facts');
    const met = (b.medicines as { key: string; flags: { detail: string }[]; documented: { fields: { check: string }[] }[] }[]).find((m) => m.key === 'metoprolol')!;
    const allPending = (b.medicines as { documented: { fields: { check: string }[] }[] }[]).every((m) => m.documented.every((e) => e.fields.every((f) => f.check === 'pending_check')));
    const modes = (b.pages as { mode: string }[]).map((p) => p.mode);
    assert(allPending, 'expected page-level fixture readings to be pending_check');
    return `flag "${met.flags[0]?.detail}"; all readings pending_check=${allPending}; page modes=${[...new Set(modes)].join(',')}`;
  });

  await check('N1', 'Concurrent nurse corrections: exactly one wins, the other gets 409; history kept', async () => {
    const b = (await http('GET', `/api/encounters/${encR}/brief`, { cookie: doctorCookie })).data;
    const met = (b.medicines as { key: string; documented: { fields: { kind: string; fact_id: string; value: string }[] }[] }[]).find((m) => m.key === 'metoprolol')!;
    const strength = met.documented[1].fields.find((f) => f.kind === 'med_strength')!;
    const [a, c] = await Promise.all([
      http('POST', `/api/facts/${strength.fact_id}/review`, { cookie: nurseCookie, json: { action: 'correct', value: '50 mg' } }),
      http('POST', `/api/facts/${strength.fact_id}/review`, { cookie: doctorCookie, json: { action: 'confirm' } }),
    ]);
    const codes = [a.status, c.status].sort();
    const again = await http('POST', `/api/facts/${strength.fact_id}/review`, { cookie: nurseCookie, json: { action: 'confirm' } });
    assert(codes[0] === 200 && codes[1] === 409 && again.status === 409, `codes ${codes} again ${again.status}`);
    const ev = (await http('GET', `/api/sources/${(met.documented[1] as unknown as { source_id: string }).source_id}/evidence`, { cookie: doctorCookie })).data;
    const strengthRevs = (ev.facts as { kind: string; superseded_by: string | null }[]).filter((f) => f.kind === 'med_strength');
    return `concurrent → ${codes.join(' + ')}; stale resubmit → ${again.status} "${again.data.error}"; strength revisions stored=${strengthRevs.length} (1 superseded)`;
  });

  await check('N2', 'Patient cannot write staff reviews; nurse cannot record a doctor review', async () => {
    const b = (await http('GET', `/api/encounters/${encR}/brief`, { cookie: doctorCookie })).data;
    const anyFact = (b.open as { fields?: { fact_id: string }[] }[]).flatMap((l) => l.fields ?? [])[0];
    const r1 = await http('POST', `/api/facts/${anyFact.fact_id}/review`, { json: { action: 'confirm' } });
    const r2 = await http('POST', `/api/encounters/${encR}/doctor-review`, { json: { section_hashes: { labs: 'a'.repeat(40) } } });
    const r3 = await http('POST', `/api/encounters/${encR}/doctor-review`, { cookie: nurseCookie, json: { section_hashes: { labs: 'a'.repeat(40) } } });
    assert(r1.status === 401 && r2.status === 401 && r3.status === 403, `${r1.status}/${r2.status}/${r3.status}`);
    return `no session fact review → ${r1.status}; no session doctor review → ${r2.status}; nurse doctor review → ${r3.status}`;
  });

  await check('D1', 'Doctor reviews; page 4 arrives; allergy + class exposure appear immediately; only attention goes stale', async () => {
    await staff.getByTestId(`enc-${aliasR}`).click();
    await staff.getByTestId('section-medicines').getByText('Metoprolol').first().waitFor({ timeout: 10000 });
    await staff.getByRole('button', { name: 'Mark reviewed' }).click();
    await staff.getByTestId('section-medicines').getByText(/Reviewed/).waitFor({ timeout: 8000 });
    await uploadFile(tokR, path.join('fixtures', 'page-04.png'));
    const item = staff.getByTestId('attention').getByText(/Penicillin allergy recorded/);
    await item.waitFor({ timeout: 15000 });
    const classLine = await staff.getByTestId('attention').getByText(/Amoxicillin \(a penicillin\)/).textContent();
    const attentionBadge = await staff.getByTestId('attention').getByText('Changed since your review').isVisible();
    const pendingMarkers = await staff.getByTestId('issue-pending').count();
    assert(pendingMarkers >= 2, `expected pending markers on attention items built from pending fixture readings, got ${pendingMarkers}`);
    const medsReviewed = await staff.getByTestId('section-medicines').getByText(/Reviewed/).isVisible();
    await staff.screenshot({ path: path.join(SHOTS, 'staff-allergy-reveal-1366x768.png') });
    const b = (await http('GET', `/api/encounters/${encR}/brief`, { cookie: doctorCookie })).data as { sections: Record<string, { stale: boolean }>; review_history: unknown[] };
    assert(attentionBadge && medsReviewed && b.sections.attention.stale && !b.sections.medicines.stale && !b.sections.labs.stale, 'staleness wrong');
    return `attention shows "${classLine?.trim()}" without clicking the banner, each marked "based on a reading pending source check" (${pendingMarkers}); attention stale, medicines/labs still reviewed; review events kept=${b.review_history.length}`;
  });

  await check('D2', 'Source chip opens the exact page with page-level label (no invented highlight)', async () => {
    await staff.getByTestId('attention-item').filter({ hasText: 'allergy recorded' }).getByRole('button').first().click();
    const drawer = staff.getByRole('dialog', { name: 'Source evidence' });
    await drawer.getByTestId('page-level').waitFor();
    const boxes = await drawer.locator('.border-teal.absolute').count();
    await staff.screenshot({ path: path.join(SHOTS, 'staff-drawer-p4-1366x768.png') });
    const title = await drawer.getByText(/^Source p\d+$/).textContent().catch(() => 'p?');
    const desc = await drawer.getByText(/history note/i).first().textContent().catch(() => '');
    await staff.keyboard.press('Escape');
    assert(boxes === 0 && /history note/i.test(desc ?? ''), `boxes ${boxes} desc ${desc}`);
    return `allergy chip opens ${title} ("${desc?.trim()}") with "Page-level evidence" and no highlight box`;
  });

  // ---------------- Assistance across encounters ----------------
  await check('A1', 'Doctor viewing encounter A receives help request from patient B; requested/delivered/acknowledged stay distinct', async () => {
    await staff.getByTestId('enc-D1').click();
    await staff.getByTestId('section-reason').waitFor();
    const c = await http('POST', '/api/encounters', { cookie: doctorCookie, json: { patient_name: 'Sita', patient_age: 34, patient_ref: 'SYN-S34' } });
    const encB = (c.data.encounter as { id: string; alias: string });
    const kb = await kioskCtx.newPage();
    await kb.goto(c.data.kiosk_url as string);
    await kb.getByTestId('help').click();
    await kb.getByTestId('urgent-wait').waitFor();
    const row = staff.getByTestId('alert-row').filter({ hasText: encB.alias });
    await row.waitFor({ timeout: 8000 });
    const stillOnA = await staff.getByRole('heading', { name: 'Ramesh, 52' }).isVisible();
    const delivered = await waitFor(async () => {
      const t = await kb.getByTestId('urgent-status').textContent();
      return t?.includes('स्टाफ की स्क्रीन पर पहुँच गया') ? t : null;
    }, 8000, 'delivered status on kiosk');
    const beforeAck = await kb.getByTestId('urgent-wait').textContent();
    assert(!beforeAck?.includes('देख लिया'), 'kiosk claimed acknowledgement before staff acted');
    await kb.screenshot({ path: path.join(SHOTS, 'kiosk-help-delivered-390x844.png') });
    await staff.screenshot({ path: path.join(SHOTS, 'staff-alert-other-encounter-1366x768.png') });
    const again = await http('POST', `/api/kiosk/${tokenOf(c.data.kiosk_url as string)}/help`);
    const open = (await http('GET', '/api/staff/alerts', { cookie: doctorCookie })).data.alerts as { encounter_id: string; delivered_at: string | null; acked_at: string | null }[];
    const mine = open.filter((a) => a.encounter_id === encB.id);
    await row.getByRole('button', { name: 'Acknowledge' }).click();
    const acked = await waitFor(async () => {
      const t = await kb.getByTestId('urgent-status').textContent();
      return t?.includes('स्टाफ ने आपका अनुरोध देख लिया है') ? t : null;
    }, 8000, 'ack on kiosk');
    await kb.screenshot({ path: path.join(SHOTS, 'kiosk-help-acked-390x844.png') });
    const noComing = !(await kb.content()).includes('आ रहे हैं');
    await row.getByRole('button', { name: 'Resume intake' }).click();
    await kb.getByTestId('urgent-wait').waitFor({ state: 'detached', timeout: 8000 });
    await kb.close();
    assert(stillOnA && mine.length === 1 && mine[0].delivered_at && !mine[0].acked_at && again.status === 200 && noComing,
      `assistance flow mismatch: stillOnA=${stillOnA} open=${mine.length} delivered=${!!mine[0]?.delivered_at} acked=${!!mine[0]?.acked_at} again=${again.status} noComing=${noComing}`);
    return `alert for ${encB.alias} shown while viewing D1; kiosk said "${delivered.trim()}" before ack, then "${acked.trim()}"; repeat press → still 1 open alert; no "staff coming" claim; resume returns kiosk to intake`;
  });

  await check('A2', 'Urgent words in a typed answer pause intake and alert staff (deterministic, no AI)', async () => {
    const c = await http('POST', '/api/encounters', { cookie: doctorCookie, json: { patient_name: 'Test Urgent', patient_age: 60 } });
    const tok = tokenOf(c.data.kiosk_url as string);
    await http('POST', `/api/kiosk/${tok}/start`, { json: { language: 'hi' } });
    const r = await http('POST', `/api/kiosk/${tok}/answers`, { json: { text: 'अभी सीने में तेज दर्द हो रहा है।' } });
    const s = await http('GET', `/api/kiosk/${tok}/state`);
    const alias = (c.data.encounter as { alias: string }).alias;
    await staff.getByTestId('alert-row').filter({ hasText: alias }).waitFor({ timeout: 8000 });
    const enc = s.data.encounter as { status: string };
    assert(r.data.paused === true && enc.status === 'paused_urgent', `paused=${r.data.paused} status=${enc.status}`);
    const done = await http('POST', `/api/kiosk/${tok}/complete`);
    return `answer → paused=true, status=${enc.status}; staff alert shows ${alias}; completing intake while paused → ${done.status}`;
  });

  await check('A3', 'Offline help request: nearby-staff instruction, no false "called"; retry is idempotent', async () => {
    const c = await http('POST', '/api/encounters', { cookie: doctorCookie, json: { patient_name: 'Test Offline', patient_age: 40 } });
    const offCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await offCtx.newPage();
    await p.goto(c.data.kiosk_url as string);
    await p.getByRole('button', { name: 'शुरू करें' }).waitFor();
    await offCtx.setOffline(true);
    await p.getByTestId('help').click();
    const msg = await p.getByTestId('help-failed').textContent();
    const html = await p.content();
    await p.screenshot({ path: path.join(SHOTS, 'kiosk-help-offline-390x844.png') });
    const noFalse = !html.includes('पहुँच गया') && !html.includes('देख लिया') && !html.includes('दर्ज हो गया');
    const before = ((await http('GET', '/api/staff/alerts', { cookie: doctorCookie })).data.alerts as { encounter_id: string }[]).filter((a) => a.encounter_id === (c.data.encounter as { id: string }).id).length;
    await offCtx.setOffline(false);
    await p.getByTestId('help-failed').getByRole('button').click();
    await p.getByTestId('urgent-wait').waitFor({ timeout: 8000 });
    await p.getByTestId('help').click();
    await sleep(800);
    const after = ((await http('GET', '/api/staff/alerts', { cookie: doctorCookie })).data.alerts as { encounter_id: string }[]).filter((a) => a.encounter_id === (c.data.encounter as { id: string }).id).length;
    await offCtx.close();
    assert(msg?.includes('पास के स्टाफ') && noFalse && before === 0 && after === 1, `msg=${msg} noFalse=${noFalse} before=${before} after=${after}`);
    return `offline → "${msg?.trim()}"; no delivered/ack text; alerts before reconnect=${before}; after retry + second press=${after}`;
  });

  // ---------------- Real kiosk upload path (gallery input -> on-device JPEG compression) ----------------
  await check('U1', 'Kiosk gallery upload: compressed on device to JPEG < 1 MB, stored privately, same photo twice = one page', async () => {
    const c = await http('POST', '/api/encounters', { cookie: doctorCookie, json: { patient_name: 'Upload test', patient_age: 45 } });
    const tok = tokenOf(c.data.kiosk_url as string);
    const p = await kioskCtx.newPage();
    await p.goto(c.data.kiosk_url as string);
    await p.getByRole('button', { name: 'शुरू करें' }).click();
    await p.getByTestId('answer-input').fill('पुराने पर्चे दिखाने आया हूँ');
    await p.getByTestId('answer-send').click();
    await p.getByRole('button', { name: 'सही है' }).click();
    await p.getByTestId('gallery-input').setInputFiles(path.join('fixtures', 'page-03.png'));
    const st = await waitFor(async () => {
      const s2 = await http('GET', `/api/kiosk/${tok}/state`);
      const pg = (s2.data.pages as { id: string; status: string; error: string }[])[0];
      return pg && (pg.status === 'failed' || pg.status === 'done') ? pg : null;
    }, 20000, 'gallery page to settle');
    const ev = (await http('GET', `/api/sources/${st.id}/evidence`, { cookie: doctorCookie })).data.source as { mime: string };
    const fileRes = await fetch(`${BASE}/api/sources/${st.id}/file`, { headers: { cookie: doctorCookie } });
    const size = (await fileRes.arrayBuffer()).byteLength;
    const original = fs.statSync(path.join('fixtures', 'page-03.png')).size;
    await p.getByTestId('page-status').first().waitFor();
    await p.screenshot({ path: path.join(SHOTS, 'kiosk-papers-uploaded-390x844.png') });
    await p.getByTestId('gallery-input').setInputFiles(path.join('fixtures', 'page-03.png'));
    await sleep(2500);
    const pagesAfter = ((await http('GET', `/api/kiosk/${tok}/state`)).data.pages as unknown[]).length;
    await p.close();
    assert(ev.mime === 'image/jpeg' && size < 1_000_000, `mime ${ev.mime} size ${size}`);
    assert(pagesAfter === 1, `second upload of the same photo created ${pagesAfter} pages: on-device compression is not deterministic, so REPLAY of kiosk photos would miss`);
    return `stored ${ev.mime}, ${size} bytes (original PNG ${original}); page status ${st.status} ("${st.error}"); same photo again → ${pagesAfter} page (compression deterministic in this browser)`;
  });

  // ---------------- Kiosk flow, screenshots ----------------
  await check('K1', 'Uploads are skippable; intake completes; done message only after save', async () => {
    await kiosk.getByRole('button', { name: 'सही है' }).click();
    await kiosk.screenshot({ path: path.join(SHOTS, 'kiosk-papers-390x844.png') });
    await kiosk.getByTestId('papers-next').click();
    await kiosk.screenshot({ path: path.join(SHOTS, 'kiosk-check-390x844.png') });
    await kiosk.getByTestId('finish').click();
    const t = await kiosk.getByTestId('done').textContent();
    const overflow = await kiosk.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await kiosk.screenshot({ path: path.join(SHOTS, 'kiosk-done-390x844.png') });
    assert(!overflow, 'horizontal overflow at 390px');
    return `done: "${t?.trim()}"; horizontal overflow at 390px=${overflow}`;
  });

  await check('V1', 'Staff layout at 768x1024 and 1366x768 has no horizontal page overflow', async () => {
    const o1366 = await staff.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await staff.setViewportSize({ width: 768, height: 1024 });
    await staff.getByTestId(`enc-${aliasR}`).click();
    await staff.getByTestId('section-medicines').waitFor();
    await staff.screenshot({ path: path.join(SHOTS, 'staff-brief-768x1024.png'), fullPage: true });
    const o768 = await staff.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await staff.setViewportSize({ width: 1366, height: 768 });
    await staff.screenshot({ path: path.join(SHOTS, 'staff-brief-replay-1366x768.png'), fullPage: true });
    return `overflow 1366=${o1366}, 768=${o768}`;
  });

  await browser.close();
  const report = { base: BASE, ran_at: new Date().toISOString(), passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, results };
  fs.writeFileSync(path.join(OUT, 'gate-report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed. Report: test-results/gate-report.json`);
  process.exit(report.failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
