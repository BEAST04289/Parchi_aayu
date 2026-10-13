import 'server-only';

/**
 * Provider selection. Defaults are local and free: PaddleOCR (local ML service) + Qwen3-VL via Ollama.
 * Cloud providers run only when explicitly selected AND configured. Google Vision and Anthropic are
 * off by default. Gemini is optional, and falls back to the local model on quota/availability errors.
 */
/** 'paddle' = PP-OCR models run locally by RapidOCR/ONNX in services/ml. */
export type OcrProvider = 'paddle' | 'vision';
export type ExtractionProvider = 'ollama' | 'gemini' | 'anthropic';

export const cfg = {
  ocrProvider: (process.env.OCR_PROVIDER === 'vision' ? 'vision' : 'paddle') as OcrProvider,
  extractionProvider: (['gemini', 'anthropic'].includes(process.env.EXTRACTION_PROVIDER ?? '') ? process.env.EXTRACTION_PROVIDER : 'ollama') as ExtractionProvider,
  mlUrl: (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8765').replace(/\/$/, ''),
  mlToken: process.env.ML_SERVICE_TOKEN || '',
  ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3-vl:4b-instruct',
  geminiKey: process.env.GEMINI_API_KEY || '',
  // Default from the Gemini models page (13 Oct 2026: 3.5 Flash-Lite recommended for new projects). Free-tier availability
  // and the generateContent + responseJsonSchema request shape are UNVERIFIED until a key is configured.
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  /** Provisional, provider-specific low-confidence thresholds (uncalibrated until measured; see HANDOFF). */
  lowConf: { paddle: Number(process.env.OCR_LOW_CONF_PADDLE ?? 0.8), vision: Number(process.env.OCR_LOW_CONF_VISION ?? 0.8) },
  /** One GPU/CPU: one page at a time across all encounters by default. */
  pageConcurrency: Math.max(1, Number(process.env.PAGE_CONCURRENCY ?? 1)),
  /** A claim older than this is treated as interrupted. Local cold inference can take minutes. */
  leaseMinutes: Math.max(2, Number(process.env.PAGE_LEASE_MINUTES ?? 10)),
  ocrTimeoutMs: Number(process.env.OCR_TIMEOUT_MS ?? 120_000),
  extractTimeoutMs: Number(process.env.EXTRACT_TIMEOUT_MS ?? 240_000),
};

export function publicProviderStatus() {
  return {
    ocr: cfg.ocrProvider === 'vision' ? { provider: 'Google Vision (cloud)', configured: !!process.env.GOOGLE_VISION_API_KEY } : { provider: 'PP-OCR via RapidOCR (local)', configured: !!cfg.mlToken },
    extraction:
      cfg.extractionProvider === 'gemini' ? { provider: `Gemini ${cfg.geminiModel} (cloud, falls back to local ${cfg.ollamaModel})`, configured: !!cfg.geminiKey }
      : cfg.extractionProvider === 'anthropic' ? { provider: `Anthropic ${process.env.PARCHI_MODEL || 'claude-opus-5-5'} (cloud)`, configured: !!process.env.ANTHROPIC_API_KEY }
      : { provider: `${cfg.ollamaModel} via Ollama (local)`, configured: true },
  };
}
