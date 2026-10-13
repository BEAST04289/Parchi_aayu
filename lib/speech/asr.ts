import 'server-only';
import { cfg } from '../pipeline/config';
import { ProviderError } from '../pipeline/errors';
import type { ProviderStep } from '../types';

export interface AsrResult { text: string; segments: { start: number; end: number; text: string }[]; language: string; language_probability: number; duration_s: number; ms: number; cold: boolean; model: string }

async function call(audio: Buffer, task: 'transcribe' | 'translate', prompt: string | null): Promise<AsrResult> {
  if (!cfg.mlToken) throw new ProviderError('config', 'ML_SERVICE_TOKEN is not configured, so local speech recognition cannot run.');
  const q = new URLSearchParams({ language: 'hi', task });
  if (prompt) q.set('initial_prompt', prompt);
  let res: Response;
  try {
    res = await fetch(`${cfg.mlUrl}/transcribe?${q}`, { method: 'POST', headers: { 'x-ml-token': cfg.mlToken, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(audio), signal: AbortSignal.timeout(90_000) });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new ProviderError('timeout', 'Local speech recognition timed out.');
    throw new ProviderError('local_unavailable', 'Local speech service unavailable.');
  }
  if (!res.ok) throw new ProviderError('local_error', `Local speech recognition failed (HTTP ${res.status}).`);
  return (await res.json()) as AsrResult;
}

/**
 * Local faster-whisper (multilingual). The Hindi/Hinglish transcript is the source text; the English
 * rendering is Whisper's own translate task and is labelled as such. language_probability is the
 * model's language guess, never a transcript accuracy score. The prompt only biases vocabulary
 * (medicine names); it never adds words to the transcript.
 */
export async function transcribeLocal(audio: Buffer, vocabulary: string[]): Promise<{ hi: AsrResult; en: AsrResult | null; steps: { asr: ProviderStep; translate?: ProviderStep } }> {
  const prompt = vocabulary.length ? `दवाइयाँ / medicines: ${vocabulary.slice(0, 40).join(', ')}.` : null;
  const hi = await call(audio, 'transcribe', prompt);
  let en: AsrResult | null = null;
  try {
    if (hi.text.trim()) en = await call(audio, 'translate', null);
  } catch {
    en = null; // English rendering is optional; the original transcript is what staff see first
  }
  return {
    hi, en,
    steps: {
      asr: { provider: 'faster-whisper', model: hi.model, mode: 'local', ms: hi.ms, cold: hi.cold },
      ...(en ? { translate: { provider: 'faster-whisper (translate task)', model: en.model, mode: 'local' as const, ms: en.ms } } : {}),
    },
  };
}
