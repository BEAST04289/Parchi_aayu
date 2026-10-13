/**
 * The exact evaluation demo, run live in Edge against the running local stack (no cloud keys):
 * typed complaint -> read-back -> page upload (LIVE local OCR + Qwen3-VL) -> adaptive follow-ups
 * (answer + पता नहीं) -> finish -> staff brief (timeline, medicines, source drawer) -> nurse action
 * -> refresh persistence -> help + acknowledgement. Screenshots in test-results/screens/demo-*.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:3000';
const PASS = process.env.STAFF_PASSCODE!;
const SHOTS = path.join(process.cwd(), 'test-results', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const staffCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const kioskCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffCtx.newPage();
  await staff.goto(`${BASE}/staff`);
  await staff.getByLabel('Staff passcode').fill(PASS);
  await staff.getByLabel('Your name').fill('Sharma');
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await staff.getByText('Demo role: Doctor').waitFor();
  await staff.getByRole('button', { name: '+ Create encounter' }).click();
  await staff.getByLabel('Patient name').fill('Ramesh');
  await staff.getByLabel('Age').fill('52');
  await staff.getByLabel('Patient ID (optional)').fill('SYN-R52');
  await staff.getByRole('button', { name: 'Create', exact: true }).click();
  const kioskUrl = (await staff.getByTestId('kiosk-url').textContent())!.trim();
  await staff.getByRole('button', { name: 'Go to brief' }).click();
  log(`encounter created; kiosk ${kioskUrl.slice(0, 40)}…`);

  const kiosk = await kioskCtx.newPage();
  await kiosk.goto(kioskUrl);
  await kiosk.getByRole('button', { name: 'शुरू करें' }).click();
  await kiosk.getByTestId('answer-input').fill('आज पुराने पर्चे और रिपोर्ट दिखाने आया हूँ। दवा का नाम याद नहीं है। सफेद गोली लेता हूँ।');
  await kiosk.getByTestId('answer-send').click();
  await kiosk.getByTestId('readback-text').waitFor();
  await kiosk.getByRole('button', { name: 'सही है' }).click();
  const t0 = Date.now();
  await kiosk.getByTestId('gallery-input').setInputFiles([path.join('fixtures', 'page-01.png'), path.join('fixtures', 'page-03.png')]);
  await kiosk.getByTestId('page-thumb').nth(1).waitFor({ timeout: 30000 });
  await kiosk.screenshot({ path: path.join(SHOTS, 'demo-kiosk-papers.png') });
  log('2 pages uploaded (LIVE)');
  await kiosk.getByTestId('papers-next').click();

  // Adaptive follow-ups: answer the first, "पता नहीं" for the next, wait for document-based ones.
  const asked: string[] = [];
  for (let i = 0; i < 6 && asked.length < 3; i++) {
    const q = kiosk.getByTestId('question');
    const done = kiosk.getByTestId('finish');
    await Promise.race([q.waitFor({ timeout: 240000 }), done.waitFor({ timeout: 240000 })]);
    if (await done.isVisible()) break;
    const text = (await kiosk.getByTestId('question-text').textContent())!.trim();
    const details = await kiosk.getByTestId('question-details').textContent().catch(() => null);
    asked.push(text + (details ? ` [${details}]` : ''));
    await kiosk.screenshot({ path: path.join(SHOTS, `demo-kiosk-question-${asked.length}.png`) });
    if (text.includes('पुरानी दवा')) {
      await kiosk.getByTestId('question-input').fill('मैं अभी पुरानी 25 मिलीग्राम वाली दवा ले रहा हूँ। नई दवा अभी खरीद नहीं पाया।');
      await kiosk.getByTestId('q-send').click();
    } else if (asked.length === 1) {
      await kiosk.getByTestId('question-input').fill('दो हफ्ते से');
      await kiosk.getByTestId('q-send').click();
    } else {
      await kiosk.getByTestId('q-unknown').click();
    }
    log(`question ${asked.length}: ${asked[asked.length - 1]}`);
    // Wait until the answered question is gone from the screen before reading the next one.
    const end = Date.now() + 20000;
    while (Date.now() < end && (await kiosk.getByTestId('question-text').textContent().catch(() => null))?.trim() === text) await sleep(300);
    // If papers are still being read, wait on the waiting screen (it re-checks every 3 s).
    if (await kiosk.getByTestId('questions-waiting').isVisible().catch(() => false)) {
      const waitEnd = Date.now() + 240000;
      while (Date.now() < waitEnd && await kiosk.getByTestId('questions-waiting').isVisible().catch(() => false)) await sleep(1500);
    }
  }
  for (let i = 0; i < 20 && !(await kiosk.getByTestId('finish').isVisible().catch(() => false)); i++) {
    const cont = kiosk.getByRole('button', { name: 'आगे बढ़ें' });
    if (await cont.isVisible().catch(() => false)) await cont.click();
    await sleep(500);
  }
  await kiosk.getByTestId('finish').click();
  await kiosk.getByTestId('done').waitFor();
  log('intake finished');

  // Staff: apply banner, check brief.
  const banner = staff.getByTestId('change-banner');
  await banner.waitFor({ timeout: 30000 }).catch(() => {});
  if (await banner.isVisible()) await staff.getByRole('button', { name: 'Review changes' }).click();
  await staff.getByTestId('section-medicines').getByText('Metoprolol').first().waitFor({ timeout: 240000 });
  const uploadToBrief = Date.now() - t0;
  await staff.reload();
  await staff.getByTestId('enc-' + (await staff.locator('[data-testid^="enc-"]').first().getAttribute('data-testid'))!.slice(4)).click();
  await staff.getByTestId('section-medicines').getByText('Metoprolol').first().waitFor();
  await staff.screenshot({ path: path.join(SHOTS, 'demo-staff-brief.png'), fullPage: true });
  const timeline = await staff.getByTestId('section-timeline').textContent();
  const meds = await staff.getByTestId('section-medicines').textContent();
  const reason = await staff.getByTestId('section-reason').textContent();
  log(`timeline: ${timeline?.replace(/\s+/g, ' ').slice(0, 160)}`);

  // Source drawer from a medicine field.
  await staff.getByTestId('section-medicines').getByRole('button', { name: /Open source p\d/ }).first().click();
  const drawer = staff.getByRole('dialog', { name: 'Source evidence' });
  await drawer.waitFor();
  await sleep(1500);
  const hl = await drawer.locator('.border-teal.absolute').count();
  const drawerNote = await drawer.getByTestId('ocr-highlight').textContent().catch(() => drawer.getByTestId('page-level').textContent().catch(() => ''));
  await staff.screenshot({ path: path.join(SHOTS, 'demo-staff-drawer.png') });
  await staff.keyboard.press('Escape');

  // Nurse: act on a pending reading if one exists.
  const queueTab = staff.getByRole('tab', { name: /Needs source check/ });
  const queueLabel = await queueTab.textContent();
  let nurse = 'no pending readings';
  if (!/\(0\)/.test(queueLabel ?? '')) {
    await queueTab.click();
    await staff.getByTestId('queue-item').first().getByRole('button', { name: 'Confirm reading' }).click();
    await sleep(1500);
    nurse = `confirmed one reading; queue now: ${await queueTab.textContent()}`;
    await staff.screenshot({ path: path.join(SHOTS, 'demo-staff-queue.png') });
    await staff.getByRole('tab', { name: 'Brief' }).click();
  }

  // Help + acknowledgement.
  await kiosk.getByTestId('help').click();
  const row = staff.getByTestId('alert-row').first();
  await row.waitFor({ timeout: 10000 });
  await row.getByRole('button', { name: 'Acknowledge' }).click();
  await kiosk.getByText('स्टाफ ने आपका अनुरोध देख लिया है।').waitFor({ timeout: 10000 });
  await row.getByRole('button', { name: 'Resume intake' }).click();
  log('help delivered, acknowledged, resumed');
  await kiosk.reload();
  await browser.close();

  const report = { upload_to_brief_s: Math.round(uploadToBrief / 1000), questions_asked: asked, highlight_boxes_in_drawer: hl, drawer_note: drawerNote, nurse, reason_excerpt: reason?.replace(/\s+/g, ' ').slice(0, 300), meds_excerpt: meds?.replace(/\s+/g, ' ').slice(0, 300) };
  fs.writeFileSync(path.join('test-results', 'demo-flow.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error('DEMO FLOW FAILED:', e.message); process.exit(1); });
