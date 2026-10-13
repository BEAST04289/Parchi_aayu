/** A processing failure. Never a statement about the document's content or readability. */
export class ProviderError extends Error {
  constructor(public kind: 'config' | 'vision' | 'claude' | 'rate_limit' | 'timeout' | 'invalid_response' | 'replay_miss', message: string) {
    super(message);
  }
}
