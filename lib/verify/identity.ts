import type { Encounter, Source } from '../types';

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Ages written as "52", "52 M", "52 years", "52y", "52/M". */
export function parseAge(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,3})(?=\s|$|[a-z/])/i);
  return m ? Number(m[1]) : null;
}

/** Label words and honorifics that are not part of anyone's name. */
const NOT_NAME = new Set(['name', 'patient', 'pt', 'mr', 'mrs', 'ms', 'shri', 'sri', 'smt', 'master', 'baby', 'kumari', 'km', 'age', 'sex', 'm', 'f']);
const nameTokens = (s: string) => (s.toLowerCase().match(/\p{L}[\p{L}\p{M}]*/gu) ?? []).filter((t) => !NOT_NAME.has(t) && t.length > 1);

/**
 * Lenient by design (PLAN.md §3): it must never withhold the patient's own pages.
 * matched: ID matches, or a name token is close to the encounter's first name (edit distance <= 2 or
 * prefix) and the ages agree within ±1 when both are known.
 * unchecked: no readable name, or the name is close but the age differs (possible misread; not withheld).
 * withheld: a name is present and NO name token is close to the encounter's name ("Sita" vs "Ramesh").
 */
export function checkIdentity(
  enc: Pick<Encounter, 'patient_name' | 'patient_age' | 'patient_ref'>,
  doc: { name: string | null; age: string | null; id: string | null },
): Source['identity'] {
  const norm = (x: string) => x.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (doc.id && enc.patient_ref && norm(doc.id) === norm(enc.patient_ref)) return 'matched';
  const docTokens = doc.name ? nameTokens(doc.name) : [];
  const encFirst = nameTokens(enc.patient_name)[0];
  if (docTokens.length === 0 || !encFirst) return 'unchecked';
  const close = docTokens.some((a) => editDistance(a, encFirst) <= 2 || a.startsWith(encFirst) || encFirst.startsWith(a));
  if (!close) return 'withheld';
  const docAge = parseAge(doc.age);
  if (docAge !== null && enc.patient_age !== null && Math.abs(docAge - enc.patient_age) > 1) return 'unchecked';
  return 'matched';
}
