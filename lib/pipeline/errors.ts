/** A processing failure. Never a statement about the document's content or readability. */
export class ProviderError extends Error {
  constructor(public kind: 'config' | 'vision' | 'claude' | 'gemini' | 'rate_limit' | 'quota' | 'timeout' | 'invalid_response' | 'replay_miss' | 'local_unavailable' | 'local_error', message: string, public retryAfterMs?: number) {
    super(message);
  }
}
