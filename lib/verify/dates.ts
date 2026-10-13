import type { DocDate } from '../types';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);
function valid(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Deterministic document-date parsing from the raw text on the page. Never uses upload time.
 * Month in words -> exact. Numeric with first part > 12 -> DD/MM. Both parts <= 12 -> assumed DD/MM
 * (labelled as an assumption). Anything else -> unknown.
 */
export function parseDocDate(raw: string | null | undefined): DocDate {
  if (!raw || !raw.trim()) return { raw: null, iso: null, precision: 'unknown' };
  const r = raw.trim();
  const lower = r.toLowerCase();
  const dmyWords = lower.match(/(\d{1,2})(?:st|nd|rd|th)?[\s.\-/]*([a-z]{3,9})[\s.,\-/]*(\d{2,4})/);
  if (dmyWords && MONTHS[dmyWords[2]]) {
    const d = +dmyWords[1], m = MONTHS[dmyWords[2]], y = fullYear(+dmyWords[3]);
    if (valid(y, m, d)) return { raw: r, iso: `${y}-${pad(m)}-${pad(d)}`, precision: 'day' };
  }
  const mdyWords = lower.match(/([a-z]{3,9})[\s.\-/]*(\d{1,2})(?:st|nd|rd|th)?[\s.,\-/]+(\d{4})/);
  if (mdyWords && MONTHS[mdyWords[1]]) {
    const m = MONTHS[mdyWords[1]], d = +mdyWords[2], y = +mdyWords[3];
    if (valid(y, m, d)) return { raw: r, iso: `${y}-${pad(m)}-${pad(d)}`, precision: 'day' };
  }
  const isoLike = r.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoLike && valid(+isoLike[1], +isoLike[2], +isoLike[3])) return { raw: r, iso: r, precision: 'day' };
  const num = r.match(/(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/);
  if (num) {
    const a = +num[1], b = +num[2], y = fullYear(+num[3]);
    if (a > 12 && valid(y, b, a)) return { raw: r, iso: `${y}-${pad(b)}-${pad(a)}`, precision: 'day' };
    if (a <= 12 && b <= 12 && valid(y, b, a)) return { raw: r, iso: `${y}-${pad(b)}-${pad(a)}`, precision: 'day', assumed_dmy: true };
    return { raw: r, iso: null, precision: 'unknown' };
  }
  const monthYear = lower.match(/([a-z]{3,9})[\s.,\-/]*(\d{4})/);
  if (monthYear && MONTHS[monthYear[1]]) return { raw: r, iso: `${monthYear[2]}-${pad(MONTHS[monthYear[1]])}-01`, precision: 'month' };
  return { raw: r, iso: null, precision: 'unknown' };
}

export function dateLabel(d: DocDate | null | undefined): string | null {
  if (!d || !d.iso) return null;
  const [y, m, day] = d.iso.split('-').map(Number);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  if (d.precision === 'month') return `${mon} ${y}`;
  return `${pad(day)} ${mon} ${y}${d.assumed_dmy ? ' (assumed DD/MM)' : ''}`;
}
