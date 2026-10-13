'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, timeHM } from '@/lib/client';
import { CheckTag } from './ui';
import type { CheckState } from '@/lib/types';

interface Step { provider: string; model: string; mode: string; ms: number; inference_ms?: number; cold?: boolean; error?: string }
interface EvFact { id: string; kind: string; value: string; value_en: string | null; quote: string | null; anchor: { boxes: [number, number, number, number][]; precision?: 'word' | 'line' } | null; evidence: string; check_state: CheckState; reasons: string[]; created_by: string; created_at: string; supersedes_id: string | null; superseded_by: string | null }
interface Evidence {
  source: {
    id: string; kind: 'page' | 'clip' | 'typed'; label: string; mime: string | null; status: string; error: string | null; mode: string; model: string | null;
    doc_type: string | null; clinic: string | null; date_label: string | null; doc_date_raw: string | null; identity: string; name_on_doc: string | null; readability: string;
    width: number | null; height: number | null; typed_text: string | null; transcript_hi: string | null; transcript_en: string | null; translation_by: string | null;
    created_at: string; has_file: boolean; file_url: string | null;
    provider_info: { ocr?: Step; extract?: Step; extract_fallback_from?: Step } | null; highlight: 'line' | 'word';
  };
  facts: EvFact[];
  history: { id: string; label: string; kind: string; typed_text: string | null; transcript_hi: string | null; created_at: string }[];
}

export default function EvidenceDrawer({ sourceId, factId, onClose, returnFocus }: { sourceId: string; factId: string | null; onClose: () => void; returnFocus: HTMLElement | null }) {
  const [ev, setEv] = useState<Evidence | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [openMs, setOpenMs] = useState<number | null>(null);
  const t0 = useRef(0);
  const panel = useRef<HTMLDivElement>(null);

  // The parent remounts the drawer per source (key), so state starts fresh for each source.
  useEffect(() => {
    t0.current = performance.now();
    api<Evidence>(`/api/sources/${sourceId}/evidence`).then(setEv).catch((e) => setErr(e.message));
  }, [sourceId]);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); returnFocus?.focus(); };
  }, [onClose, returnFocus]);

  useEffect(() => {
    if (ev && ev.source.kind !== 'page' && openMs === null) setOpenMs(Math.round(performance.now() - t0.current));
  }, [ev, openMs]);

  const fact = ev?.facts.find((f) => f.id === factId) ?? null;
  const boxes = fact?.anchor?.boxes?.filter((b) => b.length === 4 && b[2] > b[0] && b[3] > b[1]) ?? [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Source evidence"
        className="flex h-full w-full max-w-[560px] flex-col border-l border-line bg-surface shadow-xl outline-none">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="text-[18px] font-semibold">Source {ev?.source.label ?? ''}</div>
            {ev && <div className="text-[13px] text-ink-2">{describe(ev)}</div>}
          </div>
          <button onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-[14px] hover:bg-page" aria-label="Close evidence">Close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {err && <p className="rounded bg-red-soft p-3 text-red">Source unavailable: {err}</p>}
          {!ev && !err && <p className="text-ink-2">Loading source…</p>}
          {ev && ev.source.kind === 'page' && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <button className="rounded border border-line px-2 py-1" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Zoom out">−</button>
                <button className="rounded border border-line px-2 py-1" onClick={() => setZoom(1)}>Fit</button>
                <button className="rounded border border-line px-2 py-1" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Zoom in">+</button>
                <span className="text-[13px] text-ink-2">{Math.round(zoom * 100)}%</span>
                {ev.source.file_url && <a href={ev.source.file_url} target="_blank" rel="noopener noreferrer" className="rounded border border-line px-2 py-1 text-[13px] text-teal hover:bg-teal-soft">Open full size</a>}
                {openMs !== null && <span className="ml-auto text-[12px] text-ink-2" data-testid="evidence-open-ms">opened in {openMs} ms</span>}
              </div>
              {ev.source.file_url ? (
                <div className="overflow-auto rounded border border-line bg-page" style={{ maxHeight: '58vh' }}>
                  <div className="relative" style={{ width: `${zoom * 100}%` }}>
                    <img src={ev.source.file_url} alt={`Original page ${ev.source.label}`} className="block w-full"
                      onLoad={() => setOpenMs((m) => m ?? Math.round(performance.now() - t0.current))}
                      onError={() => setErr('the stored image could not be loaded')} />
                    {boxes.map((b, i) => (
                      <div key={i} className="pointer-events-none absolute border-[3px] border-teal bg-teal/10"
                        style={{ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` }} />
                    ))}
                  </div>
                </div>
              ) : <p className="text-ink-2">The original file is not stored.</p>}
              {fact && boxes.length === 0 && <p className="mt-2 rounded bg-amber-soft p-2 text-[14px] text-amber" data-testid="page-level">Page-level evidence — needs source check: no validated text position for this reading.</p>}
              {fact && boxes.length > 0 && <p className="mt-2 text-[13px] text-ink-2" data-testid="ocr-highlight">{fact.anchor?.precision === 'word' ? 'Word-level highlight: OCR word positions for this value.' : 'Line-level highlight: the OCR text containing this value (its exact word position could not be isolated).'}</p>}
              {ev.source.provider_info && <ProviderNote info={ev.source.provider_info} />}
              {ev.source.status === 'failed' && <p className="mt-3 rounded bg-amber-soft p-3 text-amber">Not processed: {ev.source.error}</p>}
            </>
          )}
          {ev && ev.source.kind !== 'page' && (
            <div className="space-y-3">
              <div className="rounded border border-line p-3">
                {ev.source.kind === 'clip' && ev.source.file_url && (
                  <audio controls preload="metadata" src={ev.source.file_url} className="mb-2 w-full" data-testid="clip-audio" onPlay={(e) => document.querySelectorAll('audio').forEach((a) => { if (a !== e.currentTarget) a.pause(); })} />
                )}
                <div className="mb-1 text-[13px] font-medium text-ink-2">{ev.source.kind === 'typed' ? 'Typed by the patient (verbatim)' : 'Transcript (original language, local Whisper)'}</div>
                <p className="deva text-[18px] leading-relaxed" lang="hi">{ev.source.typed_text ?? ev.source.transcript_hi}</p>
                {ev.source.transcript_en && <p className="mt-2 text-[15px] text-ink-2">{ev.source.transcript_en} <span className="text-[12px]">({ev.source.translation_by === 'sarvam' ? 'Sarvam translation' : ev.source.translation_by === 'whisper' ? 'Whisper translation (local), may be inexact' : 'AI translation'})</span></p>}
              </div>
              {ev.history.length > 0 && (
                <div className="rounded border border-line p-3">
                  <div className="mb-1 text-[13px] font-medium text-ink-2">Earlier version{ev.history.length > 1 ? 's' : ''} (kept for the record)</div>
                  {ev.history.map((h) => <p key={h.id} className="deva text-[15px] text-ink-2 line-through decoration-ink-2/40" lang="hi">{h.typed_text ?? h.transcript_hi} <span className="no-underline">[{h.label} · {timeHM(h.created_at)}]</span></p>)}
                </div>
              )}
            </div>
          )}
          {ev && fact && (
            <div className="mt-4 rounded border border-line p-3" data-testid="evidence-fact">
              <div className="text-[13px] font-medium text-ink-2">Interpreted field · {fact.kind.replace(/_/g, ' ')}</div>
              <div className="text-[18px] font-semibold">{fact.value}</div>
              {fact.quote && <div className="mt-1 text-[14px]">Quote on source: <q className="deva">{fact.quote}</q></div>}
              <div className="mt-1 flex flex-wrap gap-2"><CheckTag c={fact.check_state} /></div>
              {fact.reasons?.length > 0 && <ul className="mt-1 list-disc pl-5 text-[14px] text-amber">{fact.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <div className="mt-1 text-[12px] text-ink-2">Recorded by {fact.created_by} at {timeHM(fact.created_at)}</div>
            </div>
          )}
          {ev && ev.facts.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[14px] text-ink-2">All readings from this source, including history ({ev.facts.length})</summary>
              <ul className="mt-2 space-y-1 text-[14px]">
                {ev.facts.map((f) => (
                  <li key={f.id} className={clsx(f.superseded_by && 'text-ink-2 line-through')}>
                    {f.kind.replace(/_/g, ' ')}: {f.value} · {f.check_state.replace(/_/g, ' ')} · {f.created_by} {timeHM(f.created_at)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderNote({ info }: { info: NonNullable<Evidence['source']['provider_info']> }) {
  const fmt = (s?: Step) => (s ? `${s.provider} · ${s.model} · ${s.mode} · ${(s.ms / 1000).toFixed(1)} s${s.cold ? ' (cold start)' : ''}` : null);
  return (
    <div className="mt-2 rounded border border-line p-2 text-[12px] text-ink-2" data-testid="provider-note">
      {info.ocr && <div>OCR: {fmt(info.ocr)}</div>}
      {info.extract && <div>Extraction: {fmt(info.extract)}</div>}
      {info.extract_fallback_from && <div className="text-amber">Fell back from {info.extract_fallback_from.provider} ({info.extract_fallback_from.model}): {info.extract_fallback_from.error}</div>}
      <div>A match between OCR and the model shows where a reading came from; it does not prove it is clinically correct.</div>
    </div>
  );
}

function describe(ev: Evidence): string {
  const s = ev.source;
  if (s.kind === 'page') return [s.doc_type?.replace('_', ' '), s.clinic, s.date_label ?? (s.doc_date_raw ? `date “${s.doc_date_raw}”` : null), s.mode === 'replay' ? 'FIXTURE REPLAY' : s.mode.toUpperCase(), s.model].filter(Boolean).join(' · ') || 'Uploaded page';
  return `${s.kind === 'typed' ? 'Typed answer' : 'Voice answer'} · ${timeHM(s.created_at)}`;
}
