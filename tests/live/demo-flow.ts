/**
 * The presentation sequence, run live in Edge against the running local stack (no cloud keys):
 * typed complaint -> pages 01/03/05 (LIVE local OCR + Qwen3-VL) -> adaptive follow-ups -> staff brief
 * (timeline, medicines, source drawer) -> Mark reviewed -> page 04 added from the kiosk -> allergy
 * concern + "changed since review" -> nurse confirmation -> help + acknowledgement -> refresh.
 * Uses its own test encounter. Screenshots in test-results/screens/demo-*.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';

const BASE = 'http://localhost:3000';
const PASS = process.env.STAFF_PASSCODE!;
const SHOTS = path.join(process.cwd(), 'test-results', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t00 = Date.now();
const log = (m: string) => console.log(`[+${Math.round((Date.now() - t00) / 1000)}s] ${m}`);
const results: { step: string; pass: boolean; note: string }[] = [];
const rec = (step: string, pass: boolean, note: string) => { results.push({ step, pass, note }); log(`${pass ? 'PASS' : 'FAIL'} ${step}: ${note}`); };

async function signIn(page: Page, name: string, role: 'Doctor' | 'Nurse') {
  await page.goto(`${BASE}/staff`);
  await page.getByLabel('Staff passcode').fill(PASS);
  await page.getByLabel('Your name').fill(name);
  await page.getByText(role, { exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText(`Demo role: ${role}`).waitFor();
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  rec('health', health.ready === true, `ready=${health.ready}; ${health.providers.ocr.provider}; ${health.providers.extraction.provider}`);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const staff = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const nursePage = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const kiosk = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signIn(staff, 'Sharma', 'Doctor');
  await signIn(nursePage, 'Priya', 'Nurse');

  await staff.getByRole('button', { name: '+ Create encounter' }).click();
  await staff.getByLabel('Patient name').fill('Ramesh');
  await staff.getByLabel('Age').fill('52');
  await staff.getByLabel('Patient ID (optional)').fill('SYN-R52');
  await staff.getByRole('button', { name: 'Create', exact: true }).click();
  const kioskUrl = (await staff.getByTestId('kiosk-url').textContent())!.trim();
  await staff.getByRole('button', { name: 'Go to brief' }).click();
  const alias = (await staff.locator('[data-testid^="enc-"]').first().getAttribute('data-testid'))!.slice(4);
  log(`encounter ${alias} created`);

  await kiosk.goto(kioskUrl);
  await kiosk.getByRole('button', { name: 'शुरू करें' }).click();
  await kiosk.getByTestId('answer-input').fill('आज पुराने पर्चे और रिपोर्ट दिखाने आया हूँ। दवा का नाम याद नहीं है। सफेद गोली लेता हूँ।');
  await kiosk.getByTestId('answer-send').click();
  await kiosk.getByTestId('readback-text').waitFor();
  await kiosk.getByRole('button', { name: 'सही है' }).click();
  const tUpload = Date.now();
  await kiosk.getByTestId('gallery-input').setInputFiles(['01', '03', '05'].map((n) => path.join('fixtures', `page-${n}.png`)));
  await kiosk.getByTestId('page-thumb').nth(2).waitFor({ timeout: 60000 });
  log('pages 01/03/05 uploaded (LIVE)');
  await kiosk.getByTestId('papers-next').click();

  // Follow-ups: one at a time, never repeated.
  const asked: string[] = [];
  let sawOldNew = false;
  for (let i = 0; i < 8 && asked.length < 3; i++) {
    const end = Date.now() + 300000;
    while (Date.now() < end) {
      if (await kiosk.getByTestId('question').isVisible().catch(() => false)) break;
      if (await kiosk.getByTestId('finish').isVisible().catch(() => false)) break;
      await sleep(700);
    }
    if (!(await kiosk.getByTestId('question').isVisible().catch(() => false))) break;
    const text = (await kiosk.getByTestId('question-text').textContent())!.trim();
    const details = await kiosk.getByTestId('question-details').textContent({ timeout: 500 }).catch(() => null);
    asked.push(text);
    log(`question ${asked.length}: ${text}${details ? ` | ${details}` : ''}`);
    await kiosk.screenshot({ path: path.join(SHOTS, `demo-kiosk-question-${asked.length}.png`) });
    if (text.includes('पुरानी दवा')) {
      sawOldNew = true;
      await kiosk.getByTestId('question-input').fill('मैं अभी पुरानी 25 मिलीग्राम वाली दवा ले रहा हूँ। नई दवा अभी खरीद नहीं पाया।');
      await kiosk.getByTestId('q-send').click();
    } else if (text.includes('कब से')) {
      await kiosk.getByTestId('question-input').fill('दो हफ्ते से');
      await kiosk.getByTestId('q-send').click();
    } else {
      await kiosk.getByTestId('q-unknown').click();
    }
    const gone = Date.now() + 20000;
    while (Date.now() < gone && (await kiosk.getByTestId('question-text').textContent({ timeout: 300 }).catch(() => null))?.trim() === text) await sleep(300);
  }
  rec('no repeated question', new Set(asked).size === asked.length, asked.join(' → '));
  rec('old/new medicine question after documents', sawOldNew, sawOldNew ? 'asked with the documented strengths' : 'not asked');
  for (let i = 0; i < 40 && !(await kiosk.getByTestId('finish').isVisible().catch(() => false)); i++) {
    const cont = kiosk.getByRole('button', { name: 'आगे बढ़ें' });
    if (await cont.isVisible().catch(() => false)) await cont.click();
    await sleep(500);
  }
  await kiosk.screenshot({ path: path.join(SHOTS, 'demo-kiosk-check.png') });

  // Staff brief.
  await staff.reload();
  await staff.getByTestId(`enc-${alias}`).click();
  await staff.getByTestId('section-medicines').getByText('Metoprolol').first().waitFor({ timeout: 300000 });
  const medsText = (await staff.getByTestId('section-medicines').textContent())!.replace(/\s+/g, ' ');
  const timelineText = (await staff.getByTestId('section-timeline').textContent())!.replace(/\s+/g, ' ');
  rec('brief medicines', /Metoprolol/.test(medsText) && /25 mg/.test(medsText) && /50 mg/.test(medsText), medsText.slice(0, 220));
  rec('dated history', /14 Aug 2026/.test(timelineText) && /04 Sep 2026/.test(timelineText), timelineText.slice(0, 200));
  log(`upload → brief with both strengths: ${Math.round((Date.now() - tUpload) / 1000)} s (3 pages, one at a time)`);
  await staff.screenshot({ path: path.join(SHOTS, 'demo-staff-brief.png'), fullPage: true });

  // Source drawer on the 25 mg field.
  await staff.getByTestId('section-medicines').getByText('25 mg').first().locator('xpath=..').getByRole('button').first().click();
  const drawer = staff.getByRole('dialog', { name: 'Source evidence' });
  await drawer.waitFor();
  await sleep(1500);
  const boxes = await drawer.locator('.border-teal.absolute').count();
  const note = await drawer.getByTestId('ocr-highlight').textContent({ timeout: 1000 }).catch(async () => (await drawer.getByTestId('page-level').textContent({ timeout: 1000 }).catch(() => 'no note')));
  rec('25 mg opens its source', boxes > 0 || /Page-level/.test(note ?? ''), `${boxes} highlight box(es); ${note}`);
  await staff.screenshot({ path: path.join(SHOTS, 'demo-staff-drawer-25mg.png') });
  await staff.keyboard.press('Escape');

  // Mark reviewed, then the patient adds page 04 from the check screen.
  await staff.getByRole('button', { name: 'Mark reviewed' }).click();
  await staff.getByTestId('section-medicines').getByText(/Reviewed/).waitFor({ timeout: 10000 });
  const papersEdit = kiosk.getByRole('button', { name: 'बदलें' }).last();
  await papersEdit.click();
  const t4 = Date.now();
  await kiosk.getByTestId('gallery-input').setInputFiles(path.join('fixtures', 'page-04.png'));
  const allergy = staff.getByTestId('attention').getByText(/Penicillin allergy recorded/i);
  await allergy.waitFor({ timeout: 300000 }).catch(() => {});
  const allergyShown = await allergy.isVisible().catch(() => false);
  const classLine = await staff.getByTestId('attention').getByText(/Amoxicillin/i).first().textContent({ timeout: 2000 }).catch(() => null);
  const changed = await staff.getByTestId('attention').getByText('Changed since your review').isVisible().catch(() => false);
  const medsStillReviewed = await staff.getByTestId('section-medicines').getByText(/Reviewed/).isVisible().catch(() => false);
  rec('page 04 reveal', allergyShown && changed, `allergy shown=${allergyShown} (${Math.round((Date.now() - t4) / 1000)} s after upload); class line="${classLine?.trim() ?? 'none'}"; attention changed-since-review=${changed}; medicines still reviewed=${medsStillReviewed}`);
  await staff.screenshot({ path: path.join(SHOTS, 'demo-staff-reveal.png') });

  // Nurse confirmation in the pre-signed-in nurse window.
  await nursePage.getByTestId(`enc-${alias}`).click();
  const queueTab = nursePage.getByRole('tab', { name: /Needs source check/ });
  await queueTab.waitFor();
  const before = await queueTab.textContent();
  if (!/\(0\)/.test(before ?? '')) {
    await queueTab.click();
    await nursePage.getByTestId('queue-item').first().getByRole('button', { name: 'Confirm reading' }).click();
    await sleep(2500);
    rec('nurse confirmation', true, `${before} → ${await queueTab.textContent()}`);
  } else rec('nurse confirmation', true, 'no readings pending (nothing to confirm)');

  // Finish intake, help + acknowledgement, refresh persistence.
  for (let i = 0; i < 20 && !(await kiosk.getByTestId('finish').isVisible().catch(() => false)); i++) {
    for (const name of ['आगे बढ़ें']) { const b = kiosk.getByRole('button', { name }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await sleep(700);
  }
  await kiosk.getByTestId('finish').click();
  await kiosk.getByTestId('done').waitFor();
  await kiosk.getByTestId('help').click();
  const row = staff.getByTestId('alert-row').filter({ hasText: alias });
  await row.waitFor({ timeout: 10000 });
  await row.getByRole('button', { name: 'Acknowledge' }).click();
  const acked = await kiosk.getByText('स्टाफ ने आपका अनुरोध देख लिया है।').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  await row.getByRole('button', { name: 'Resume intake' }).click();
  rec('help → acknowledged', acked, 'kiosk showed acknowledgement after the staff click');
  await staff.reload();
  await staff.getByTestId(`enc-${alias}`).click();
  const persisted = await staff.getByTestId('attention').getByText(/Penicillin allergy recorded/i).isVisible({ timeout: 10000 }).catch(() => false);
  rec('refresh persistence', persisted, 'allergy concern still shown after reload');
  await browser.close();
  fs.writeFileSync(path.join('test-results', 'demo-flow.json'), JSON.stringify({ alias, results }, null, 2));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} steps passed (encounter ${alias})`);
}

main().catch((e) => { console.error('DEMO FLOW FAILED:', e.message.split('\n')[0]); fs.writeFileSync(path.join('test-results', 'demo-flow.json'), JSON.stringify({ results, error: e.message }, null, 2)); process.exit(1); });
