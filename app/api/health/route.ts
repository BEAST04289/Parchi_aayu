import { db, dbKind } from '@/lib/db';
import { cfg, publicProviderStatus } from '@/lib/pipeline/config';
import { mlHealth } from '@/lib/pipeline/ocr-paddle';
import { ollamaHealth } from '@/lib/pipeline/extract-lines';
import { json, route } from '@/lib/http';

/** Readiness for scripts/start-local.ps1 and the staff header. Booleans and provider names only; no secrets, no patient data. */
export const GET = route(async () => {
  let dbOk = false;
  try { await (await db()).query('select 1'); dbOk = true; } catch { dbOk = false; }
  const [ml, ollama] = await Promise.all([
    cfg.ocrProvider === 'paddle' ? mlHealth() : Promise.resolve({ ok: true, skipped: true }),
    cfg.extractionProvider !== 'anthropic' ? ollamaHealth() : Promise.resolve({ ok: true, model_present: true, skipped: true }),
  ]);
  const ready = dbOk && ml.ok && ollama.ok && ollama.model_present;
  return json({ ready, db: { ok: dbOk, kind: dbKind() }, ml_service: ml, ollama: { ...ollama, model: cfg.ollamaModel }, providers: publicProviderStatus() }, ready ? 200 : 503);
});
