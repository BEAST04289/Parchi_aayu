/**
 * Records the demo sequence as a real browser video (Playwright recordVideo, Edge), LIVE only, no replay:
 * staff sign-in -> new encounter -> patient kiosk side-by-side -> typed Hindi complaint + read-back ->
 * fresh document processing (local RapidOCR + Qwen3-VL) -> dated doctor brief -> source click with
 * highlight -> nurse source check. On-screen captions label each step. Output: test-results/video/.
 * Run against the serving app: npx tsx --env-file-if-exists=.env.local tests/live/record-demo.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';

const BASE = process.env.REC_BASE ?? 'http://localhost:3000';
const PASS = process.env.STAFF_PASSCODE!;
const OUT = path.join(process.cwd(), 'test-results', 'video');
const PAGES = (process.env.REC_PAGES ?? 'U1-rx-clinic-a-14aug,U3-lab-08sep').split(',').map((n) => path.join('fixtures', 'user', `${n}.png`));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m: string) => console.log(`[+${Math.round((Date.now() - t0) / 1000)}s] ${m}`);

async function caption(p: Page, text: string) {
  await p.evaluate((t) => {
    let d = document.getElementById('rec-cap');
    if (!d) {
      d = document.createElement('div');
      d.id = 'rec-cap';
      Object.assign(d.style, { position: 'fixed', left: '12px', bottom: '12px', zIndex: '9999', background: '#153342', color: '#fff', padding: '10px 14px', borderRadius: '8px', font: '600 17px system-ui, sans-serif', maxWidth: '62%', pointerEvents: 'none' });
      document.body.appendChild(d);
    }
    d.textContent = t;
  }, text);
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: OUT, size: { width: 1600, height: 900 } } });
  const p = await ctx.newPage();
  const steps: Record<string, string> = {};

  await p.goto(`${BASE}/staff`);
  await caption(p, '1 · Staff sign-in (synthetic demo; passcode shown for judges)');
  await sleep(1500);
  await p.getByLabel('Staff passcode').fill(PASS);
  await p.getByLabel('Your name').fill('Sharma');
  await p.getByText('Doctor', { exact: true }).click();
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByText('Demo role: Doctor').waitFor();
  await caption(p, '2 · Doctor creates an encounter for a fictional patient');
  await p.getByRole('button', { name: '+ Create encounter' }).click();
  await p.getByLabel('Patient name').fill('Ramesh');
  await p.getByLabel('Age').fill('52');
  await p.getByLabel('Patient ID (optional)').fill('SYN-R52');
  await p.getByRole('button', { name: 'Create', exact: true }).click();
  await sleep(1500);
  await p.getByRole('button', { name: 'Go to brief' }).click();
  await p.getByTestId('toggle-kiosk').click();
  const k = p.frameLocator('iframe[title="Patient kiosk"]');
  await caption(p, '3 · Patient kiosk (right) beside the doctor brief (left): typed complaint in Hindi, then read-back');
  await k.getByRole('button', { name: 'शुरू करें' }).click();
  await k.getByTestId('answer-input').fill('दो हफ्ते से चक्कर आ रहे हैं। पुराने पर्चे और रिपोर्ट दिखाने आया हूँ।');
  await sleep(800);
  await k.getByTestId('answer-send').click();
  await k.getByTestId('readback-text').waitFor();
  await sleep(2000);
  await k.getByRole('button', { name: 'सही है' }).click();
  steps.typed = 'ok';
  log('complaint typed and confirmed');

  await caption(p, '4 · Fresh LIVE document processing on this laptop: RapidOCR + Qwen3-VL 4B (no replay, no cloud)');
  const tUp = Date.now();
  await k.getByTestId('gallery-input').setInputFiles(PAGES);
  await k.getByTestId('page-thumb').nth(PAGES.length - 1).waitFor({ timeout: 60000 });
  // Wait for the brief: apply "Review changes" when it appears, until a medicine and a lab are shown.
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    const banner = p.getByRole('button', { name: 'Review changes' });
    if (await banner.isVisible().catch(() => false)) await banner.click();
    const meds = (await p.getByTestId('section-medicines').textContent().catch(() => '')) ?? '';
    const labs = (await p.getByTestId('section-labs').textContent().catch(() => '')) ?? '';
    const cov = (await p.getByTestId('coverage').textContent().catch(() => '')) ?? '';
    ready = /Metoprolol/.test(meds) && !/No lab values/.test(labs) && !/processing/.test(cov);
    if (/not processed/.test(cov) && !/processing/.test(cov)) break;
    await sleep(2000);
  }
  const banner = p.getByRole('button', { name: 'Review changes' });
  if (await banner.isVisible().catch(() => false)) await banner.click();
  steps.processing = `${ready ? 'brief ready' : 'NOT ready'} ${Math.round((Date.now() - tUp) / 1000)} s after upload; coverage: ${(await p.getByTestId('coverage').textContent())?.trim()}`;
  log(steps.processing);

  await caption(p, '5 · Dated doctor brief: allergy in Attention, medicines by date, labs against the report range');
  await p.getByTestId('attention').scrollIntoViewIfNeeded();
  await sleep(3000);
  await p.getByTestId('section-medicines').scrollIntoViewIfNeeded();
  await sleep(2500);
  await p.getByTestId('section-labs').scrollIntoViewIfNeeded();
  await sleep(2500);

  await caption(p, '6 · Source click: every value opens the original page with the OCR words highlighted');
  await p.getByTestId('section-medicines').scrollIntoViewIfNeeded();
  await p.getByTestId('section-medicines').getByText('25 mg').first().locator('xpath=..').getByRole('button').first().click();
  const dlg = p.getByRole('dialog', { name: 'Source evidence' });
  await dlg.waitFor();
  await sleep(4000);
  steps.source = `${await dlg.locator('.border-teal.absolute').count()} highlight box(es)`;
  await p.keyboard.press('Escape');

  await caption(p, '7 · Nurse source check: readings the OCR could not confirm wait here, in amber, never hidden');
  await p.getByRole('tab', { name: /Needs source check/ }).click();
  await sleep(2500);
  const item = p.getByTestId('queue-item').first();
  if (await item.isVisible().catch(() => false)) {
    await item.getByRole('button', { name: /Open source/ }).click();
    await dlg.waitFor();
    await sleep(3000);
    await p.keyboard.press('Escape');
    await item.getByRole('button', { name: 'Confirm reading' }).click();
    await sleep(2500);
    steps.nurse = `confirmed one reading; tab now: ${(await p.getByRole('tab', { name: /Needs source check/ }).textContent())?.trim()}`;
  } else steps.nurse = 'no readings pending';
  await caption(p, 'Synthetic demo · local models on a laptop · source match is not clinical approval');
  await sleep(2500);

  const video = p.video();
  await ctx.close();
  await browser.close();
  const file = video ? await video.path() : null;
  const named = path.join(OUT, `parchi-demo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.webm`);
  if (file) fs.renameSync(file, named);
  console.log(JSON.stringify({ video: file ? named : null, steps }, null, 2));
}

main().catch((e) => { console.error('RECORDING FAILED:', (e as Error).message.split('\n')[0]); process.exit(1); });
