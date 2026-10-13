import 'server-only';
import type { OcrPage, OcrWord } from '../types';
import { ProviderError } from './errors';

interface Vertex { x?: number; y?: number }
interface VSymbol { text: string; property?: { detectedBreak?: { type?: string } } }
interface VWord { symbols?: VSymbol[]; confidence?: number; boundingBox?: { vertices?: Vertex[]; normalizedVertices?: Vertex[] } }
interface VPage { width?: number; height?: number; blocks?: { paragraphs?: { words?: VWord[] }[] }[] }
export interface VisionResponse { responses?: { fullTextAnnotation?: { text?: string; pages?: VPage[] }; error?: { message?: string; code?: number } }[] }

/** Converts Vision's fullTextAnnotation into our OcrPage: words in reading order, confidence, normalized boxes, char offsets. */
export function toOcrPage(resp: VisionResponse): OcrPage {
  const r = resp.responses?.[0];
  if (r?.error) throw new ProviderError('vision', `Vision error: ${r.error.message ?? 'unknown'}`);
  const page = r?.fullTextAnnotation?.pages?.[0];
  const width = page?.width ?? null, height = page?.height ?? null;
  const words: OcrWord[] = [];
  let text = '';
  for (const block of page?.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const w of para.words ?? []) {
        const start = text.length;
        let wordText = '';
        let brk = '';
        for (const s of w.symbols ?? []) {
          wordText += s.text;
          const t = s.property?.detectedBreak?.type;
          if (t === 'SPACE' || t === 'SURE_SPACE') brk = ' ';
          else if (t === 'EOL_SURE_SPACE' || t === 'LINE_BREAK') brk = '\n';
          else if (t === 'HYPHEN') brk = '-\n';
        }
        text += wordText;
        const end = text.length;
        text += brk;
        const box = boxOf(w, width, height);
        words.push({ i: words.length, text: wordText, conf: typeof w.confidence === 'number' ? w.confidence : 0, box, start, end });
      }
    }
  }
  return { text, words, width, height };
}

function boxOf(w: VWord, width: number | null, height: number | null): [number, number, number, number] {
  const nv = w.boundingBox?.normalizedVertices;
  const v = w.boundingBox?.vertices;
  let xs: number[] = [], ys: number[] = [];
  if (nv && nv.length) { xs = nv.map((p) => p.x ?? 0); ys = nv.map((p) => p.y ?? 0); }
  else if (v && v.length && width && height) { xs = v.map((p) => (p.x ?? 0) / width); ys = v.map((p) => (p.y ?? 0) / height); }
  else return [0, 0, 0, 0]; // invalid -> verifier falls back to page-level evidence
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return [clamp(Math.min(...xs)), clamp(Math.min(...ys)), clamp(Math.max(...xs)), clamp(Math.max(...ys))];
}

export async function runVisionOcr(image: Buffer): Promise<{ page: OcrPage; raw: VisionResponse }> {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) throw new ProviderError('config', 'Processing not run: GOOGLE_VISION_API_KEY is not configured on the server.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: image.toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new ProviderError('rate_limit', 'Vision rate limited (429). Retry.');
    if (!res.ok) throw new ProviderError('vision', `Vision request failed (HTTP ${res.status}).`);
    const raw = (await res.json()) as VisionResponse;
    return { page: toOcrPage(raw), raw };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error).name === 'AbortError') throw new ProviderError('timeout', 'Vision timed out. Retry.');
    throw new ProviderError('vision', `Vision request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
