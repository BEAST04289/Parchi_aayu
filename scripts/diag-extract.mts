import fs from 'node:fs';
import { z } from 'zod';
import { LinePageExtraction, NUM_PREDICT, PAGE_SYSTEM_LINES } from '../lib/pipeline/extract-lines';
import { runLocalOcr } from '../lib/pipeline/ocr-paddle';
import { ocrLines } from '../lib/verify/lines';

const file = process.argv[2]; const out = process.argv[3]; const numCtx = Number(process.argv[4] ?? 6144);
const r = await runLocalOcr(fs.readFileSync(file));
const lines = ocrLines(r.page);
console.log('OCR lines:', lines.length, 'vlm image:', !!r.vlm);
const user = `OCR LINES:\n${lines.map((l, i) => `L${i}: ${l}`).join('\n')}\n\nENCOUNTER PATIENT: Ramesh, 52, SYN-R52`;
const t0 = Date.now();
const res = await fetch(`${process.env.OLLAMA_URL}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
  model: process.env.OLLAMA_MODEL, stream: false, keep_alive: '30m', format: z.toJSONSchema(LinePageExtraction),
  options: { temperature: 0, seed: 7, num_ctx: numCtx, num_predict: NUM_PREDICT },
  messages: [{ role: 'system', content: PAGE_SYSTEM_LINES }, { role: 'user', content: user, images: [r.vlm!.b64] }],
}) });
const body = await res.json() as { message?: { content?: string }; done_reason?: string; eval_count?: number; prompt_eval_count?: number };
const content: string = body.message?.content ?? '';
fs.writeFileSync(out, JSON.stringify({ lines, content, done_reason: body.done_reason, eval_count: body.eval_count, prompt_eval_count: body.prompt_eval_count }, null, 2));
console.log('http', res.status, 'done_reason', body.done_reason, 'eval_count', body.eval_count, 'prompt_tokens', body.prompt_eval_count, 'ms', Date.now() - t0, 'chars', content.length);
let json: unknown;
try { json = JSON.parse(content); } catch (e) { console.log('JSON.parse FAILED:', (e as Error).message, '| tail:', content.slice(-200)); process.exit(0); }
const p = LinePageExtraction.safeParse(json);
if (p.success) console.log('SCHEMA OK, items:', p.data.items.length);
else console.log('ZOD ISSUES:', JSON.stringify(p.error.issues.slice(0, 8), null, 1));
