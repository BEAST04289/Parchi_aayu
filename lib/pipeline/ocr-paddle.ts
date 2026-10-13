import 'server-only';
import { cfg } from './config';
import { ProviderError } from './errors';
import { alignWordsInLine } from '../verify/lines';
import type { OcrPage, OcrWord, ProviderStep } from '../types';

type Box = [number, number, number, number];
interface MlOcrResponse {
  width: number; height: number; ms: number; cold: boolean; model: string; granularity: 'word'; vlm_jpeg_b64: string | null;
  lines: { text: string; conf: number | null; box: Box | null; words: { text: string; conf: number; box: Box }[] }[];
}

/**
 * Local OCR (PP-OCR models via RapidOCR in the ML service). Words carry the REAL positions returned by
 * the OCR engine (normalized to the decoded size of the exact stored bytes; the service drops any word
 * box outside its line). A line without word boxes contributes one entry with its own line box. No
 * positions are interpolated. OcrPage.text keeps one OCR line per text line, which is what the
 * extraction model cites by number.
 */
export async function runLocalOcr(image: Buffer): Promise<{ page: OcrPage; step: ProviderStep; vlm: { b64: string; mime: string } | null }> {
  if (!cfg.mlToken) throw new ProviderError('config', 'Processing not run: ML_SERVICE_TOKEN is not configured, so the local OCR service cannot be called.');
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${cfg.mlUrl}/ocr?vlm_max=1280`, {
      method: 'POST', headers: { 'x-ml-token': cfg.mlToken, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(image), signal: AbortSignal.timeout(cfg.ocrTimeoutMs),
    });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') throw new ProviderError('timeout', 'Local OCR timed out. The original page is stored; retry.');
    throw new ProviderError('local_unavailable', 'Local OCR service unavailable (is it running?). The original page is stored; retry when it is up.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ProviderError('local_error', `Local OCR failed (HTTP ${res.status}${body.error ? `: ${String(body.error).slice(0, 120)}` : ''}). The original page is stored; retry.`);
  }
  const out = (await res.json()) as MlOcrResponse;
  const words: OcrWord[] = [];
  const lineTexts: string[] = [];
  let offset = 0;
  for (const line of out.lines) {
    const ranges = line.words.length ? alignWordsInLine(line.text, line.words.map((w) => w.text)) : null;
    if (ranges) {
      line.words.forEach((w, k) => words.push({ i: words.length, text: w.text, conf: w.conf, box: w.box, start: offset + ranges[k].start, end: offset + ranges[k].end, level: 'word' }));
    } else {
      // No alignable word boxes: one line-level entry. A missing line box stays [0,0,0,0], which the
      // verifier treats as invalid (page-level evidence), never as a clickable highlight.
      words.push({ i: words.length, text: line.text, conf: line.conf ?? 0, box: line.box ?? ([0, 0, 0, 0] as Box), start: offset, end: offset + line.text.length, level: 'line' });
    }
    lineTexts.push(line.text);
    offset += line.text.length + 1;
  }
  return {
    page: { text: lineTexts.join('\n'), words, width: out.width, height: out.height, granularity: 'word' },
    step: { provider: 'rapidocr', model: out.model, mode: 'local', ms: Date.now() - t0, inference_ms: out.ms, cold: out.cold },
    // Downscaled copy for the vision model only; OCR boxes stay in the stored image's coordinates.
    vlm: out.vlm_jpeg_b64 ? { b64: out.vlm_jpeg_b64, mime: 'image/jpeg' } : null,
  };
}

export async function mlHealth(): Promise<{ ok: boolean; ocr_loaded?: boolean; asr_loaded?: boolean; error?: string }> {
  try {
    const r = await fetch(`${cfg.mlUrl}/health`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()) as { ok: boolean };
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}
