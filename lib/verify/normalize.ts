/**
 * One normalization for every quote/OCR/transcript comparison (PLAN.md §3):
 * lowercase; punctuation and symbols become spaces EXCEPT a '.' between two digits ("12.5" stays
 * "12.5", never "125"); letters, combining marks (Devanagari matras) and digits are kept; tokens
 * split on whitespace and at every digit/letter boundary ("50mg" -> "50", "mg"). Never fuzzy.
 */
export function normTokens(input: string): string[] {
  let s = input.normalize('NFC').toLowerCase();
  s = s.replace(/(\p{N})\.(?=\p{N})/gu, '$1\u0000');
  s = s.replace(/[\p{P}\p{S}]/gu, ' ');
  s = s.replace(/\u0000/g, '.');
  s = s.replace(/(\p{N})(?=\p{L})/gu, '$1 ').replace(/([\p{L}\p{M}])(?=\p{N})/gu, '$1 ');
  return s.split(/\s+/).filter(Boolean);
}

/** Index of the first contiguous occurrence of needle in hay, or -1. */
export function findRun(hay: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Voice/typed facts: the quote must occur verbatim (after normalization) in the stored text. */
export function quoteFoundIn(quote: string | null | undefined, text: string | null | undefined): boolean {
  if (!quote || !text) return false;
  return findRun(normTokens(text), normTokens(quote)) >= 0;
}
