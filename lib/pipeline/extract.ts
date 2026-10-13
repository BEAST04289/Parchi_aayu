import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { PAGE_SYSTEM, TRANSCRIPT_SYSTEM } from './prompts';
import { ProviderError } from './errors';
import type { Encounter } from '../types';

export const PageExtraction = z.object({
  doc_type: z.enum(['prescription', 'lab_report', 'history_note', 'other']),
  clinic: z.string().nullable(),
  doc_date_raw: z.string().nullable(),
  name_on_doc: z.string().nullable(),
  age_on_doc: z.string().nullable(),
  id_on_doc: z.string().nullable(),
  items: z.array(z.object({
    group: z.number().int(),
    kind: z.enum(['med_name', 'med_strength', 'med_frequency', 'med_form', 'med_duration', 'allergy', 'allergy_reaction', 'lab_name', 'lab_value', 'lab_unit', 'lab_range']),
    value: z.string(),
    ocr_quote: z.string().nullable(),
    illegible: z.boolean(),
    subject: z.enum(['patient', 'other_person', 'unknown']),
    assertion: z.enum(['present', 'denied', 'uncertain']),
    temporality: z.enum(['current', 'historical', 'unknown']),
  })),
});
export type PageExtraction = z.infer<typeof PageExtraction>;

export const TranscriptExtraction = z.object({
  items: z.array(z.object({
    kind: z.enum(['visit_reason', 'complaint', 'onset', 'duration', 'patient_concern', 'med_reported_taking', 'urgent_mention']),
    value: z.string(), value_en: z.string(), quote: z.string(),
    assertion: z.enum(['present', 'denied', 'uncertain']),
    temporality: z.enum(['current', 'historical', 'unknown']),
  })),
});
export type TranscriptExtraction = z.infer<typeof TranscriptExtraction>;

export function modelId(): string {
  return process.env.PARCHI_MODEL || 'claude-opus-5-5';
}
function effort(): 'low' | 'medium' | 'high' {
  const e = process.env.PARCHI_EFFORT;
  return e === 'low' || e === 'high' ? e : 'medium';
}

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new ProviderError('config', 'Processing not run: ANTHROPIC_API_KEY is not configured on the server.');
  return new Anthropic({ timeout: 50_000, maxRetries: 1 });
}

function mapError(e: unknown): never {
  if (e instanceof ProviderError) throw e;
  if (e instanceof Anthropic.RateLimitError) throw new ProviderError('rate_limit', 'Claude rate limited (429). Retry.');
  if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError('timeout', 'Claude timed out. Retry.');
  if (e instanceof Anthropic.APIError) throw new ProviderError('claude', `Claude request failed (HTTP ${e.status ?? '?'}).`);
  throw new ProviderError('claude', `Claude request failed: ${(e as Error).message}`);
}

/** One structured-output call over the page image plus the OCR text. Invalid or truncated output is a visible failure. */
export async function extractPage(image: Buffer, mime: string, ocrText: string, enc: Encounter): Promise<PageExtraction> {
  const c = client();
  try {
    const res = await c.messages.parse({
      model: modelId(),
      max_tokens: 16000,
      system: PAGE_SYSTEM,
      output_config: { effort: effort(), format: zodOutputFormat(PageExtraction) },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime as 'image/jpeg' | 'image/png' | 'image/webp', data: image.toString('base64') } },
          { type: 'text', text: `OCR TEXT:\n${ocrText || '(OCR returned no text)'}\n\nENCOUNTER PATIENT: ${enc.patient_name}, ${enc.patient_age ?? 'age unknown'}, ${enc.patient_ref ?? 'no ID'}` },
        ],
      }],
    });
    if (res.stop_reason === 'refusal') throw new ProviderError('invalid_response', 'Claude declined to read this page.');
    if (res.stop_reason === 'max_tokens') throw new ProviderError('invalid_response', 'Claude output was cut off (max_tokens).');
    if (!res.parsed_output) throw new ProviderError('invalid_response', 'Claude returned output that did not match the schema.');
    return res.parsed_output;
  } catch (e) {
    mapError(e);
  }
}

export async function extractTranscript(transcript: string, questionContext: string): Promise<TranscriptExtraction> {
  const c = client();
  try {
    const res = await c.messages.parse({
      model: modelId(),
      max_tokens: 8000,
      system: TRANSCRIPT_SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(TranscriptExtraction) },
      messages: [{ role: 'user', content: `QUESTION: ${questionContext}\n\nTRANSCRIPT:\n${transcript}` }],
    });
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens' || !res.parsed_output) {
      throw new ProviderError('invalid_response', `Transcript extraction failed (${res.stop_reason}).`);
    }
    return res.parsed_output;
  } catch (e) {
    mapError(e);
  }
}
