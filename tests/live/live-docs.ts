/**
 * LIVE local-inference document test. Real kiosk uploads (Edge, gallery input) of the NEW pages in
 * fixtures/live/, processed by the running app with local OCR + local Qwen3-VL. No fixture answers,
 * no replay: the encounter is in LIVE mode and the pages match no seeded hash.
 *
 * Requires: app on http://localhost:3000 (scripts/start-local.ps1), Ollama + ML service up, and NO
 * cloud keys. Writes test-results/live-report.json and screenshots. Run: npm run test:live
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = process.env.GATE_BASE ?? 'http://localhost:3000';
const PASS = process.env.STAFF_PASSCODE!;
const OUT = path.join(process.cwd(), 'test-results');
const SHOTS = path.join(OUT, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const gold = JSON.parse(fs.readFileSync('fixtures/live/gold.json', 'utf8')).pages as Record<string, {
  file: string; kind: string; doc_date: string; name: string; fields: { kind: string; value: string; assertion?: string }[];
  ambiguous?: { kind: string; intended: string }[]; must_not?: string[];
}>;
const ORDER = (process.env.LIVE_PAGES ?? 'L2,L1,L3,L4').split(',');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const k of ['ANTHROPIC_API_KEY', 'GOOGLE_VISION_API_KEY', 'GEMINI_API_KEY', 'SARVAM_API_KEY']) {
  if (process.env[k]) throw new Error(`${k} is set: this test must run with all cloud keys unset`);
}

async function http(method: string, url: string, cookie?: string, json?: unknown) {
  const r = await fetch(BASE + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(json ? { 'content-type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
function mem(): Record<string, number> {
  const ps = `$os=Get-CimInstance Win32_OperatingSystem; $o=@{free_ram_mb=[math]::Round($os.FreePhysicalMemory/1KB)}; foreach($n in 'node','python','ollama','ollama app','msedge'){ $o[$n+'_mb']=[math]::Round(((Get-Process -Name $n -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum)/1MB) }; $g = (& nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) 2>$null; if ($g) { $o['gpu_used_mb'] = [int]$g }; $o | ConvertTo-Json -Compress`;
  try { return JSON.parse(execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { encoding: 'utf8' })); } catch { return {}; }
}
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/^x(?=\d)/, '');

async function main() {
  const login = await fetch(BASE + '/api/staff/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: PASS, name: 'Sharma', role: 'doctor' }) });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const health = (await http('GET', '/api/health')).data;
  if (!health.ready) throw new Error(`app not ready: ${JSON.stringify(health)}`);
  const c = await http('POST', '/api/encounters', cookie, { patient_name: 'Ramesh', patient_age: 52, patient_ref: 'SYN-R52' });
  const enc = c.data.encounter as { id: string; alias: string; mode: string };
  const kioskUrl = c.data.kiosk_url as string;
  if (enc.mode !== 'live') throw new Error('encounter not in LIVE mode');

  // Cold start: unload the extraction model so the first page includes model load.
  await fetch(`${process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'}/api/generate`, { method: 'POST', body: JSON.stringify({ model: process.env.OLLAMA_MODEL ?? 'qwen3-vl:4b-instruct', keep_alive: 0 }) });
  await sleep(1500);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const kctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await sctx.addCookies([{ name: 'parchi_staff', value: cookie.split('=').slice(1).join('='), url: BASE }]);
  const staff = await sctx.newPage();
  await staff.goto(`${BASE}/staff`);
  await staff.getByTestId(`enc-${enc.alias}`).click();
  const kiosk = await kctx.newPage();
  await kiosk.goto(kioskUrl);
  await kiosk.getByRole('button', { name: 'शुरू करें' }).click();
  await kiosk.getByTestId('answer-input').fill('पुराने पर्चे और रिपोर्ट दिखाने आया हूँ');
  await kiosk.getByTestId('answer-send').click();
  await kiosk.getByRole('button', { name: 'सही है' }).click();
  const memBefore = mem();

  const pages: Record<string, unknown>[] = [];
  let seen = 0;
  for (const [n, id] of ORDER.entries()) {
    const g = gold[id];
    const t0 = Date.now();
    await kiosk.getByTestId('gallery-input').setInputFiles(path.join('fixtures', 'live', g.file));
    // Wait for the new page to reach a terminal state (persisted state, polled like the kiosk does).
    const tok = kioskUrl.split('/k/')[1];
    let page: { id: string; label: string; status: string; error: string | null } | undefined;
    let tUploaded = 0;
    while (Date.now() - t0 < 15 * 60_000) {
      const s = await http('GET', `/api/kiosk/${tok}/state`).catch(() => null);
      if (!s) { await sleep(500); continue; }
      const list = s.data.pages as { id: string; label: string; status: string; error: string | null }[];
      if (list.length > seen) {
        if (!tUploaded) tUploaded = Date.now();
        page = list[list.length - 1];
        if (page.status === 'done' || page.status === 'failed') break;
      }
      await sleep(500);
    }
    seen += 1;
    const tDone = Date.now();
    const ev = (await http('GET', `/api/sources/${page!.id}/evidence`, cookie)).data as { source: { provider_info: Record<string, { ms: number; inference_ms?: number; cold?: boolean; model: string }>; model: string; doc_date_raw: string | null; date_label: string | null; name_on_doc: string | null; identity: string }; facts: { kind: string; value: string; check_state: string; reasons: string[]; quote: string | null; anchor: { boxes: number[][]; precision?: string } | null; superseded_by: string | null; assertion?: string }[] };
    const facts = ev.facts.filter((f) => !f.superseded_by);
    // Brief visibility: the staff brief API must contain this source's facts.
    const brief = (await http('GET', `/api/encounters/${enc.id}/brief`, cookie)).data;
    const tBrief = Date.now();

    const used = new Set<number>();
    const fieldResults = g.fields.map((gf) => {
      const idx = facts.findIndex((f, i) => !used.has(i) && f.kind === gf.kind && norm(f.value) === norm(gf.value));
      if (idx >= 0) { used.add(idx); return { ...gf, result: 'correct', check_state: facts[idx].check_state, precision: facts[idx].anchor?.precision ?? null, reasons: facts[idx].reasons }; }
      const sameKind = facts.findIndex((f, i) => !used.has(i) && f.kind === gf.kind);
      if (sameKind >= 0) { used.add(sameKind); return { ...gf, result: 'wrong', got: facts[sameKind].value, check_state: facts[sameKind].check_state, reasons: facts[sameKind].reasons }; }
      return { ...gf, result: 'missing' };
    });
    const extras = facts.filter((_, i) => !used.has(i)).map((f) => ({ kind: f.kind, value: f.value, check_state: f.check_state, reasons: f.reasons }));
    const ambiguity = (g.ambiguous ?? []).map((a) => {
      const f = facts.filter((x) => x.kind === a.kind);
      return { ...a, facts: f.map((x) => ({ value: x.value, check_state: x.check_state, reasons: x.reasons })), ok: f.every((x) => x.check_state !== 'source_matched') };
    });
    const pi = ev.source.provider_info ?? {};
    const rec = {
      id, file: g.file, kind: g.kind, label: page!.label, status: page!.status, error: page!.error,
      timing_ms: { upload_to_done: tDone - t0, upload_request: tUploaded ? tUploaded - t0 : null, ocr: pi.ocr?.ms ?? null, ocr_inference: pi.ocr?.inference_ms ?? null, extract: pi.extract?.ms ?? null, extract_inference: pi.extract?.inference_ms ?? null, brief_fetch: tBrief - tDone },
      cold: { ocr: pi.ocr?.cold ?? null, extract: pi.extract?.cold ?? null }, run_index: n,
      providers: { ocr: pi.ocr?.model, extract: pi.extract?.model }, model_label: ev.source.model,
      doc: { date_raw: ev.source.doc_date_raw, date_label: ev.source.date_label, expected_date: g.doc_date, name_on_doc: ev.source.name_on_doc, identity: ev.source.identity },
      fields: fieldResults, extras, ambiguity,
      counts: { expected: g.fields.length, correct: fieldResults.filter((f) => f.result === 'correct').length, wrong: fieldResults.filter((f) => f.result === 'wrong').length, missing: fieldResults.filter((f) => f.result === 'missing').length, extra: extras.length,
        correct_source_matched: fieldResults.filter((f) => f.result === 'correct' && 'check_state' in f && f.check_state === 'source_matched').length },
      brief_attention: (brief.attention as { title: string }[]).map((a) => a.title),
      memory: mem(),
    };
    pages.push(rec);
    console.log(`${id} ${page!.label} ${page!.status} upload->done ${(rec.timing_ms.upload_to_done / 1000).toFixed(1)}s (ocr ${rec.timing_ms.ocr}ms, extract ${rec.timing_ms.extract}ms${rec.cold.extract ? ', model cold' : ''}) correct ${rec.counts.correct}/${rec.counts.expected}, wrong ${rec.counts.wrong}, missing ${rec.counts.missing}, extra ${rec.counts.extra}${page!.error ? ` ERROR ${page!.error}` : ''}`);
  }

  // Screenshot: open the first word-level highlighted field in the drawer.
  await staff.reload();
  await staff.getByTestId(`enc-${enc.alias}`).click();
  await staff.getByTestId('section-medicines').waitFor();
  const chip = staff.getByTestId('section-medicines').getByRole('button', { name: /Open source p\d/ }).nth(1);
  if (await chip.count()) {
    await chip.click();
    await staff.getByRole('dialog', { name: 'Source evidence' }).waitFor();
    await sleep(1200);
    await staff.screenshot({ path: path.join(SHOTS, 'live-drawer-highlight-1366x768.png') });
    await staff.keyboard.press('Escape');
  }
  await staff.screenshot({ path: path.join(SHOTS, 'live-brief-1366x768.png'), fullPage: true });
  await kiosk.screenshot({ path: path.join(SHOTS, 'live-kiosk-papers-390x844.png') });
  await browser.close();

  const report = { ran_at: new Date().toISOString(), base: BASE, encounter: enc.alias, mode: 'LIVE (local OCR + local extraction; no cloud keys)', providers: health.providers, memory_before: memBefore, pages,
    note: 'Font-rendered synthetic pages (fixtures/live). Not handwriting evidence. Gold labels written before outputs.' };
  fs.writeFileSync(path.join(OUT, 'live-report.json'), JSON.stringify(report, null, 2));
  console.log('report: test-results/live-report.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
