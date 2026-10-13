import 'server-only';
import { cfg } from '../pipeline/config';
import { ProviderError } from '../pipeline/errors';
import { TRANSCRIPT_SYSTEM } from '../pipeline/prompts';
import { extractTranscript, TranscriptExtraction } from '../pipeline/extract';
import { z } from 'zod';

const SCHEMA = z.toJSONSchema(TranscriptExtraction);

/** Text-only extraction of a patient's answer with the local model (default) or Anthropic if explicitly selected. */
export async function extractAnswer(transcript: string, questionContext: string): Promise<{ items: TranscriptExtraction['items']; model: string }> {
  if (cfg.extractionProvider === 'anthropic') return { items: (await extractTranscript(transcript, questionContext)).items, model: process.env.PARCHI_MODEL || 'claude-opus-5-5' };
  let res: Response;
  try {
    res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(cfg.extractTimeoutMs),
      body: JSON.stringify({
        model: cfg.ollamaModel, stream: false, keep_alive: '30m', format: SCHEMA,
        options: { temperature: 0, seed: 7, num_ctx: Number(process.env.OLLAMA_NUM_CTX ?? 4096) },
        messages: [{ role: 'system', content: TRANSCRIPT_SYSTEM }, { role: 'user', content: `QUESTION: ${questionContext}\n\nTRANSCRIPT:\n${transcript}` }],
      }),
    });
  } catch {
    throw new ProviderError('local_unavailable', 'Local extraction model unavailable.');
  }
  const body = (await res.json().catch(() => ({}))) as { message?: { content?: string }; error?: string };
  if (!res.ok) throw new ProviderError('local_error', `Local extraction failed (${body.error ?? res.status}).`);
  try {
    return { items: TranscriptExtraction.parse(JSON.parse(body.message?.content ?? '')).items, model: cfg.ollamaModel };
  } catch {
    throw new ProviderError('invalid_response', 'Local model output did not match the schema.');
  }
}
