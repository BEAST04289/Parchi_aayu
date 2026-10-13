'use client';
import clsx from 'clsx';
import type { CheckState, FieldRef, SectionState, SourceRef } from '@/lib/types';
import { timeHM } from '@/lib/client';

/** Brand lockup: navy tile with प (parchi) and the wordmark. Decorative; the text carries the name. */
export function Brand({ suffix, size = 'md' }: { suffix?: string; size?: 'md' | 'lg' }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={clsx('deva grid place-items-center rounded-lg bg-ink font-bold text-white shadow-card', size === 'lg' ? 'h-9 w-9 text-[20px]' : 'h-7 w-7 text-[16px]')}>प</span>
      <span className={clsx('font-bold tracking-tight text-ink', size === 'lg' ? 'text-[22px]' : 'text-[18px]')}>parchi</span>
      {suffix && <span className={clsx('font-normal text-ink-2', size === 'lg' ? 'text-[18px]' : 'text-[15px]')}>{suffix}</span>}
    </span>
  );
}

export type OpenSource =(sourceId: string, factId?: string | null, trigger?: HTMLElement | null) => void;

export function SourceChip({ r, onOpen, factId }: { r: Pick<SourceRef, 'source_id' | 'label'>; onOpen: OpenSource; factId?: string | null }) {
  return (
    <button
      type="button"
      onClick={(e) => onOpen(r.source_id, factId ?? null, e.currentTarget)}
      className="inline-flex items-center rounded-full border border-teal/25 bg-teal-soft/70 px-2 py-0.5 text-[12.5px] font-semibold text-teal hover:border-teal hover:bg-teal hover:text-white"
      aria-label={`Open source ${r.label}`}
    >
      [{r.label}]
    </button>
  );
}

const CHECK_TEXT: Record<CheckState, string> = {
  source_matched: 'source matched',
  pending_check: 'pending source check',
  nurse_confirmed: 'source checked',
  nurse_corrected: 'corrected from source',
  unreadable: 'marked unreadable',
};

export function CheckTag({ c }: { c: CheckState | 'mixed' | 'verbatim' }) {
  if (c === 'verbatim') return <span className="rounded-full bg-page px-2 py-0.5 text-[12px] font-medium text-ink-2 ring-1 ring-line">patient&apos;s own words</span>;
  if (c === 'mixed') return null;
  return (
    <span className={clsx('rounded-full px-2 py-0.5 text-[12px] font-medium',
      c === 'pending_check' || c === 'unreadable' ? 'bg-amber-soft text-amber' : c === 'source_matched' ? 'bg-page text-ink-2' : 'bg-teal-soft text-teal')}>
      {c === 'nurse_confirmed' || c === 'nurse_corrected' ? '✓ ' : c === 'pending_check' ? '⚠ ' : ''}{CHECK_TEXT[c]}
    </span>
  );
}

/** A single clinical value with its own source action. Pending readings stay visible, in amber. */
export function Field({ f, onOpen, big }: { f: FieldRef; onOpen: OpenSource; big?: boolean }) {
  const pending = f.check === 'pending_check' || f.check === 'unreadable';
  return (
    <span className={clsx('inline-flex flex-wrap items-baseline gap-1', pending && 'rounded bg-amber-soft px-1 text-amber')}>
      <span className={clsx(big ? 'text-[18px] font-semibold' : 'text-[16px]')}>{f.display}</span>
      <SourceChip r={{ source_id: f.source_id, label: f.source_label }} onOpen={onOpen} factId={f.fact_id} />
      {pending && <span className="text-[12px] font-medium">⚠ {f.check === 'unreadable' ? 'marked unreadable' : 'pending source check'}</span>}
      {(f.check === 'nurse_confirmed' || f.check === 'nurse_corrected') && <span className="text-[12px] font-medium text-teal" title="Checked against the source by staff. Not clinical approval.">✓ checked</span>}
    </span>
  );
}

export function SectionHead({ title, state, pinnedHash, extra }: { title: string; state?: SectionState; pinnedHash?: string; extra?: React.ReactNode }) {
  let badge: React.ReactNode = null;
  if (state && state.reviewed_hash) {
    const shownHash = pinnedHash ?? state.hash;
    badge = state.reviewed_hash === shownHash
      ? <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[12.5px] font-medium text-teal">✓ Reviewed {timeHM(state.reviewed_at)} · {state.reviewed_by}</span>
      : <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[12.5px] font-semibold text-amber ring-1 ring-amber/20">Changed since your review</span>;
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <h3 className="flex items-center gap-2 text-[16px] font-semibold tracking-tight text-ink"><span aria-hidden className="h-4 w-1 rounded-full bg-teal" />{title}</h3>
      {badge}
      {extra}
    </div>
  );
}
