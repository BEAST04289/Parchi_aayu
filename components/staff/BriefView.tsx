'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, ApiError, timeHM } from '@/lib/client';
import { CheckTag, Field, SectionHead, SourceChip, type OpenSource } from './ui';
import type { Brief, BriefLine, FieldRef, Issue, RevInfo, SectionKey, StaffRole } from '@/lib/types';

const BODY: SectionKey[] = ['reason', 'medicines', 'labs', 'timeline', 'open'];
const DOC_LABEL: Record<string, string> = { prescription: 'Prescription', lab_report: 'Lab report', history_note: 'History note', other: 'Document' };
const TITLES: Record<SectionKey, string> ={ attention: 'Attention', reason: 'Reason for visit', medicines: 'Medicines', labs: 'Recent labs', timeline: 'Dated history', open: 'Open questions and coverage' };

/**
 * The brief body is pinned to what the reader has on screen. New attention items (allergy, identity)
 * apply immediately; other changes wait behind "New information · Review changes". Polls every 2 s.
 */
export default function BriefView({ encounterId, role, onOpen, readOnly = false }: { encounterId: string; role: StaffRole; onOpen: OpenSource; readOnly?: boolean }) {
  const [pinned, setPinned] = useState<Brief | null>(null);
  const [latest, setLatest] = useState<Brief | null>(null);
  const [changed, setChanged] = useState<SectionKey[]>([]);
  const [flash, setFlash] = useState<SectionKey[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [tab, setTab] = useState<'brief' | 'queue'>(role === 'nurse' ? 'queue' : 'brief');
  const latestRef = useRef<Brief | null>(null);
  const pinnedRef = useRef<Brief | null>(null);
  useEffect(() => { latestRef.current = latest; pinnedRef.current = pinned; }, [latest, pinned]);

  const fetchBrief = useCallback(async () => {
    const b = await api<Brief>(`/api/encounters/${encounterId}/brief`);
    setLatest(b);
    if (!pinnedRef.current) { pinnedRef.current = b; setPinned(b); }
    return b;
  }, [encounterId]);

  // The parent remounts this component per encounter (key), so there is no state to reset here.
  useEffect(() => {
    // Initial fetch; state is set asynchronously when the response arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBrief().then(() => setLastSync(new Date())).catch((e) => setErr(e.message));
  }, [fetchBrief]);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const rev = await api<RevInfo>(`/api/encounters/${encounterId}/rev`);
        setLastSync(new Date());
        setErr(null);
        const l = latestRef.current, p = pinnedRef.current;
        if (!l || !p) return;
        if (rev.revision !== l.revision || rev.live_hash !== l.live_hash) await fetchBrief();
        const diff = BODY.filter((k) => rev.section_hashes[k] !== p.sections[k].hash);
        setChanged(diff);
      } catch (e) {
        setErr(e instanceof ApiError && e.status === 0 ? 'Disconnected' : (e as Error).message);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [encounterId, fetchBrief]);

  const applyChanges = () => {
    if (!latest) return;
    setFlash(changed);
    setPinned(latest);
    setChanged([]);
    setTimeout(() => setFlash([]), 2000);
  };

  if (err && !latest) return <div className="p-6 text-red">Could not load this encounter: {err}</div>;
  if (!pinned || !latest) return <div className="p-6 text-ink-2">Loading brief…</div>;

  const enc = latest.encounter;
  const reviewHashes = { ...Object.fromEntries(BODY.map((k) => [k, pinned.sections[k].hash])), attention: latest.sections.attention.hash };
  const pendingFields = latest.open.flatMap((l) => (l.fields ?? []).filter((f) => f.check === 'pending_check'));

  const markReviewed = async () => {
    try {
      await api(`/api/encounters/${encounterId}/doctor-review`, { method: 'POST', json: { section_hashes: reviewHashes, revision: pinned.revision } });
      await fetchBrief();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-4">
      {/* Patient header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="text-[30px] font-bold leading-tight tracking-tight">{enc.patient_name}{enc.patient_age !== null ? `, ${enc.patient_age}` : ''}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
            <span>{enc.alias}{enc.patient_ref ? ` · ${enc.patient_ref}` : ''}</span>
            <span className={clsx('rounded-full px-2.5 py-0.5 text-[13px] font-semibold', enc.status === 'paused_urgent' ? 'bg-red-soft text-red' : enc.status === 'ready' ? 'bg-teal-soft text-teal' : 'bg-page')}>
              {enc.status === 'paused_urgent' ? 'Intake paused: help requested' : enc.status === 'ready' ? 'Intake complete' : 'Intake in progress'}
            </span>
            <span data-testid="coverage">{latest.coverage.pages} page{latest.coverage.pages === 1 ? '' : 's'} · {latest.coverage.read} read{latest.coverage.processing ? ` · ${latest.coverage.processing} processing` : ''}{latest.coverage.failed ? ` · ${latest.coverage.failed} not processed` : ''}{latest.coverage.withheld ? ` · ${latest.coverage.withheld} withheld` : ''} · {latest.coverage.answers} answer{latest.coverage.answers === 1 ? '' : 's'}</span>
            <span title={pinned.revision}>Snapshot {pinned.revision.slice(0, 6)}</span>
            <span className={clsx(err ? 'text-red' : '')}>{err ? `${err} · last sync ${timeHM(lastSync?.toISOString())}` : `Synced ${timeHM(lastSync?.toISOString())}`}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-surface p-1 shadow-card ring-1 ring-line/70" role="tablist">
            <button role="tab" aria-selected={tab === 'brief'} onClick={() => setTab('brief')} className={clsx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', tab === 'brief' ? 'bg-teal text-white shadow-card' : 'text-ink-2 hover:bg-page')}>Brief</button>
            <button role="tab" aria-selected={tab === 'queue'} onClick={() => setTab('queue')} className={clsx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', tab === 'queue' ? 'bg-teal text-white shadow-card' : 'text-ink-2 hover:bg-page')}>Needs source check ({pendingFields.length})</button>
          </div>
          {role === 'doctor' && tab === 'brief' && !readOnly && <button onClick={markReviewed} className="rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-white shadow-card hover:shadow-lift">Mark reviewed</button>}
        </div>
      </div>

      {/* Reserved banner slot (no layout jump) */}
      <div className="min-h-[44px] py-1.5" aria-live="polite">
        {changed.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-teal/40 bg-teal-soft px-4 py-2.5 shadow-card" data-testid="change-banner">
            <span>New information: {changed.map((k) => TITLES[k].toLowerCase()).join(', ')}</span>
            <button onClick={applyChanges} className="rounded bg-teal px-3 py-1 text-[14px] font-medium text-white">Review changes</button>
          </div>
        )}
      </div>

      {/* Attention strip: always current */}
      <section aria-label="Attention" className="mb-4" data-testid="attention">
        <SectionHead title="Attention" state={latest.sections.attention} />
        {latest.alerts.length > 0 && latest.alerts.map((a) => (
          <div key={a.id} className="mb-2 rounded-xl border border-red/40 border-l-4 border-l-red bg-red-soft px-4 py-2.5 text-red shadow-card">
            <strong>Urgent · help requested</strong> {a.quote ? <>· patient said: “<span className="deva">{a.quote}</span>”</> : '· help button pressed on kiosk'}
            <span className="ml-2 text-[13px]">Requested {timeHM(a.requested_at)}{a.acked_at ? ` · acknowledged by ${a.acked_by} ${timeHM(a.acked_at)}` : ' · not yet acknowledged'}</span>
          </div>
        ))}
        {latest.attention.length === 0 && latest.alerts.length === 0 && <p className="text-[15px] text-ink-2">No allergy or identity concerns recorded in the processed sources. This is not a statement that none exist.</p>}
        <div className="space-y-2">{latest.attention.map((i) => <IssueRow key={i.id} i={i} onOpen={onOpen} />)}</div>
      </section>

      {/* Every uploaded paper, always visible: click opens the original with its readings. */}
      <section aria-label="Pages" className="mb-5 rounded-xl border border-line/70 bg-surface p-4 shadow-card" data-testid="pages">
        <h3 className="mb-3 flex items-center gap-2 text-[16px] font-semibold tracking-tight"><span aria-hidden className="h-4 w-1 rounded-full bg-teal" />Patient&apos;s papers ({latest.pages.length})<span className="text-[13px] font-normal text-ink-2">· click a page to open it</span></h3>
        {latest.pages.length === 0 ? <Empty text="No pages uploaded." /> : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
            {latest.pages.map((p) => (
              <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-line/70 bg-page shadow-card hover:-translate-y-0.5 hover:shadow-lift">
                <button type="button" onClick={(e) => onOpen(p.id, null, e.currentTarget)} aria-label={`Open source ${p.label}`}
                  className="group relative block h-[150px] overflow-hidden bg-surface focus-visible:outline-2 focus-visible:outline-teal">
                  <img src={`/api/sources/${p.id}/file`} alt={`Original page ${p.label}`} loading="lazy" className="h-full w-full object-cover object-top group-hover:opacity-90" />
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-ink/90 px-2 py-0.5 text-[12px] font-semibold text-white shadow-card">{p.label}</span>
                </button>
                <div className="px-2 py-1.5 text-[13px] leading-snug">
                  <div className="font-medium">{(p.doc_type ? DOC_LABEL[p.doc_type] : null) ?? 'Page'}{p.date_label ? ` · ${p.date_label}` : ''}</div>
                  {p.clinic && <div className="truncate text-ink-2" title={p.clinic}>{p.clinic}</div>}
                  <div className="flex items-center gap-1.5">
                    <span className={clsx(p.status === 'failed' || p.readability === 'unreadable' || p.identity === 'withheld' ? 'text-amber' : 'text-ink-2')}>{pageStatus(p.status, p.readability, p.identity)}</span>
                    <span className="text-[11px] text-ink-2">{p.mode === 'replay' ? 'FIXTURE REPLAY' : p.mode.toUpperCase()}</span>
                  </div>
                  {p.status === 'failed' && !readOnly && <div className="mt-1"><RetryButton id={p.id} onDone={fetchBrief} /></div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {tab === 'queue' ? (
        <NurseQueue fields={pendingFields} onOpen={onOpen} onDone={fetchBrief} readOnly={readOnly} />
      ) : (
        <div className="grid gap-5">
          <Section k="reason" pinned={pinned} latest={latest} flash={flash}>
            {pinned.reason.length === 0 ? <Empty text="The patient has not answered yet." /> : pinned.reason.map((l) => <Line key={l.id} l={l} onOpen={onOpen} />)}
          </Section>

          <Section k="medicines" pinned={pinned} latest={latest} flash={flash}>
            {pinned.medicines.length === 0 ? <Empty text="No medicines read from processed pages yet." /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead><tr className="border-b border-line text-[14px] text-ink-2"><th className="py-1.5 pr-3 font-medium">Medicine</th><th className="py-1.5 pr-3 font-medium">Documented prescription</th><th className="py-1.5 font-medium">Patient reports</th></tr></thead>
                  <tbody>
                    {pinned.medicines.map((r) => (
                      <tr key={r.key} className="border-b border-line align-top">
                        <td className="py-2 pr-3 text-[17px] font-semibold">{r.name}</td>
                        <td className="py-2 pr-3">
                          {r.documented.length === 0 && <span className="text-ink-2">None documented</span>}
                          {r.documented.map((e) => (
                            <div key={e.group_key} className="mb-1 flex flex-wrap items-baseline gap-x-2">
                              {e.fields.filter((f) => f.kind !== 'med_name').map((f) => <Field key={f.fact_id} f={f} onOpen={onOpen} />)}
                              {e.fields.filter((f) => f.kind === 'med_name').map((f) => <span key={f.fact_id} className="text-[13px] text-ink-2">name <Field f={f} onOpen={onOpen} /></span>)}
                              <span className="text-[13px] text-ink-2">{e.date_label ?? 'undated'}</span>
                            </div>
                          ))}
                          {r.flags.map((fl) => <div key={fl.id} className="mt-1 text-[14px] text-amber">⚠ {fl.title}: {fl.detail}</div>)}
                        </td>
                        <td className="py-2">{r.patient_reports.length === 0 ? <span className="text-ink-2">Not stated</span> : r.patient_reports.map((f) => <div key={f.fact_id}><Field f={f} onOpen={onOpen} /></div>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[13px] text-ink-2">A prescription shows what was prescribed on its date, not current use. No instruction to change treatment.</p>
              </div>
            )}
          </Section>

          <Section k="labs" pinned={pinned} latest={latest} flash={flash}>
            {pinned.labs.length === 0 ? <Empty text="No lab values read yet." /> : pinned.labs.map((l) => (
              <div key={l.key} className="mb-1 flex flex-wrap items-baseline gap-x-3">
                {l.name ? <Field f={l.name} onOpen={onOpen} /> : <span>Lab</span>}
                {l.value && <Field f={l.value} onOpen={onOpen} big />}
                {l.unit && <Field f={l.unit} onOpen={onOpen} />}
                {l.range && <span className="text-[14px] text-ink-2">Report range <Field f={l.range} onOpen={onOpen} /></span>}
                <span className={clsx('text-[14px] font-medium', l.status === 'below' || l.status === 'above' ? 'text-amber' : 'text-ink-2')}>{l.status === 'unclassified' ? 'not classified' : `${l.status} report range`}</span>
                <span className="text-[13px] text-ink-2">{l.date_label ?? 'undated'}</span>
              </div>
            ))}
          </Section>

          <Section k="timeline" pinned={pinned} latest={latest} flash={flash}>
            {pinned.timeline.length === 0 && pinned.undated.length === 0 ? <Empty text="No dated documents yet. Dates come only from the documents, never from upload time." /> : (
              <ol className="flex flex-wrap gap-3">
                {pinned.timeline.map((t, i) => (
                  <li key={i} className="min-w-[150px] rounded-lg border border-line/70 border-t-[3px] border-t-teal bg-page/60 px-3 py-2">
                    <div className="text-[14px] font-semibold">{t.date_label}</div>
                    <div className="text-[14px]">{t.title}</div>
                    <div className="mt-1 flex gap-1">{t.refs.map((r) => <SourceChip key={r.source_id} r={r} onOpen={onOpen} />)}</div>
                  </li>
                ))}
                {pinned.undated.map((t, i) => (
                  <li key={`u${i}`} className="min-w-[150px] rounded-lg border border-dashed border-line px-3 py-2">
                    <div className="text-[14px] font-semibold text-amber">Undated</div>
                    <div className="text-[14px]">{t.title}</div>
                    <div className="text-[13px] text-ink-2">{t.date_label}</div>
                    <div className="mt-1 flex gap-1">{t.refs.map((r) => <SourceChip key={r.source_id} r={r} onOpen={onOpen} />)}</div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section k="open" pinned={pinned} latest={latest} flash={flash}>
            {pinned.open.length === 0 ? <Empty text="No open items." /> : pinned.open.map((l) => <Line key={l.id} l={l} onOpen={onOpen} />)}
          </Section>

          <footer className="border-t border-line pt-2 text-[14px] text-ink-2" data-testid="ledger">
            <strong className="text-ink">Citation coverage:</strong> {latest.ledger.lines} lines · {latest.ledger.with_source_link} link to a stored source · {latest.ledger.without_source_link} without a source link · {latest.ledger.pending_check} pending source check · {latest.ledger.human_checked} checked by staff · {latest.ledger.held_back} AI readings held back
            {latest.timers.intake_seconds !== null && <> · kiosk intake {Math.round(latest.timers.intake_seconds / 60)} min (measured)</>}
            <div className="text-[12px]">A source link shows where a line came from. It does not prove the interpretation is correct.</div>
            {latest.review_history.length > 0 && <div className="text-[12px]">Review history: {latest.review_history.map((r) => `${r.actor} ${timeHM(r.at)}`).join(' · ')}</div>}
          </footer>
        </div>
      )}
    </div>
  );
}

function Section({ k, pinned, latest, flash, children }: { k: SectionKey; pinned: Brief; latest: Brief; flash: SectionKey[]; children: React.ReactNode }) {
  return (
    <section aria-label={TITLES[k]} data-testid={`section-${k}`} className={clsx('rounded-xl border border-line/70 bg-surface p-4 shadow-card', flash.includes(k) && 'flash-changed')}>
      <SectionHead title={TITLES[k]} state={latest.sections[k]} pinnedHash={pinned.sections[k].hash} />
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[15px] text-ink-2">{text}</p>;
}

function Line({ l, onOpen }: { l: BriefLine; onOpen: OpenSource }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-2" data-testid="brief-line">
      {l.asked && <span className="w-full text-[13px] text-ink-2">Answer to: “{l.asked}”</span>}
      {l.text_hi && l.text_hi !== l.text ? (
        <span><span className="deva text-[18px]" lang="hi">“{l.text_hi}”</span> <span className="text-[15px] text-ink-2">{l.text}{l.text_en_by ? ` (${l.text_en_by === 'sarvam' ? 'Sarvam' : l.text_en_by === 'whisper' ? 'Whisper, local' : 'AI'} translation)` : ''}</span></span>
      ) : (
        <span className={clsx(l.check === 'verbatim' ? 'deva text-[18px]' : 'text-[16px]')} lang={l.check === 'verbatim' ? 'hi' : undefined}>{l.check === 'verbatim' ? `“${l.text}”` : l.text}</span>
      )}
      {l.refs.map((r) => <SourceChip key={r.source_id + r.fact_ids.join()} r={r} onOpen={onOpen} factId={r.fact_ids[0] ?? null} />)}
      {l.check === 'verbatim' && /^q\d/i.test(l.refs[0]?.label ?? '')
        ? <span className="rounded-full bg-page px-2 py-0.5 text-[12px] font-medium text-ink-2 ring-1 ring-line" title="Machine transcript of the patient's recording; open the source to play the original audio">transcript of recording · local Whisper</span>
        : <CheckTag c={l.check} />}
    </div>
  );
}

function IssueRow({ i, onOpen }: { i: Issue; onOpen: OpenSource }) {
  const red = i.level === 'urgent' || i.level === 'allergy';
  return (
    <div className={clsx('rounded-xl border border-l-4 px-4 py-2.5 shadow-card', red ? 'border-red/40 border-l-red bg-red-soft text-red' : 'border-amber/40 border-l-amber bg-amber-soft text-amber')} data-testid="attention-item">
      <strong>{i.level === 'allergy' ? 'Allergy' : i.level === 'urgent' ? 'Urgent' : 'Check'} · {i.title}</strong>
      <span className="ml-1">{i.detail}</span>
      {i.check === 'pending_check' && <span className="ml-2 rounded bg-amber-soft px-1.5 py-0.5 text-[13px] font-medium text-amber" data-testid="issue-pending">⚠ based on a reading pending source check</span>}
      <span className="ml-2 inline-flex gap-1">{i.refs.map((r) => <SourceChip key={r.source_id} r={r} onOpen={onOpen} factId={r.fact_ids[0] ?? null} />)}</span>
    </div>
  );
}

function pageStatus(status: string, readability: string, identity: string): string {
  if (status === 'uploaded') return 'received';
  if (status === 'processing') return 'reading';
  if (status === 'failed') return 'not processed';
  if (identity === 'withheld') return 'withheld: identity check';
  if (readability === 'unreadable') return 'needs retake';
  if (readability === 'partial') return 'partly readable';
  return 'read';
}

function RetryButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button disabled={busy} className="rounded border border-line px-2 py-0.5 text-[13px] hover:bg-page" onClick={async () => {
      setBusy(true);
      try { await api(`/api/sources/${id}/retry`, { method: 'POST' }); } catch (e) { alert((e as Error).message); }
      setBusy(false); onDone();
    }}>Retry</button>
  );
}

function NurseQueue({ fields, onOpen, onDone, readOnly }: { fields: FieldRef[]; onOpen: OpenSource; onDone: () => Promise<unknown>; readOnly: boolean }) {
  if (fields.length === 0) return <p className="rounded-xl border border-line/70 bg-surface p-4 shadow-card text-ink-2">No readings are waiting for a source check.</p>;
  return (
    <div className="grid gap-3" data-testid="nurse-queue">
      {readOnly && <p className="rounded-xl border border-line/70 bg-surface p-4 shadow-card text-[14px] text-ink-2">Read-only demo: a nurse confirms, corrects or marks each reading unreadable after signing in. Open a chip to compare the reading with the original page.</p>}
      {fields.map((f) => <QueueItem key={f.fact_id} f={f} onOpen={onOpen} onDone={onDone} readOnly={readOnly} />)}
      <p className="text-[13px] text-ink-2">Checking the source does not approve this medicine or dose. Clinical decisions stay with the clinician.</p>
    </div>
  );
}

function QueueItem({ f, onOpen, onDone, readOnly }: { f: FieldRef; onOpen: OpenSource; onDone: () => Promise<unknown>; readOnly: boolean }) {
  const [mode, setMode] = useState<'idle' | 'correct'>('idle');
  const [value, setValue] = useState(f.value);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (action: 'confirm' | 'correct' | 'unreadable') => {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/facts/${f.fact_id}/review`, { method: 'POST', json: { action, value: action === 'correct' ? value : undefined } });
      await onDone();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="rounded-xl border border-amber/40 border-l-4 border-l-amber bg-surface p-4 shadow-card" data-testid="queue-item">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[14px] text-ink-2">{f.kind.replace(/_/g, ' ')}</span>
        <span className="text-[18px] font-semibold">{f.display}</span>
        <SourceChip r={{ source_id: f.source_id, label: f.source_label }} onOpen={onOpen} factId={f.fact_id} />
      </div>
      <ul className="mt-1 list-disc pl-5 text-[14px] text-amber">{f.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {readOnly ? null : mode === 'correct' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor={`v-${f.fact_id}`}>Corrected value</label>
          <input id={`v-${f.fact_id}`} value={value} onChange={(e) => setValue(e.target.value)} className="rounded border border-line px-2 py-1" />
          <button disabled={busy || !value.trim()} onClick={() => act('correct')} className="rounded bg-teal px-3 py-1 text-white">Save correction</button>
          <button onClick={() => setMode('idle')} className="rounded border border-line px-3 py-1">Cancel</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => act('confirm')} className="rounded bg-teal px-3 py-1 text-white">Confirm reading</button>
          <button disabled={busy} onClick={() => setMode('correct')} className="rounded border border-line px-3 py-1">Correct</button>
          <button disabled={busy} onClick={() => act('unreadable')} className="rounded border border-line px-3 py-1">Unreadable</button>
        </div>
      )}
      {msg && <p className="mt-2 rounded bg-red-soft p-2 text-[14px] text-red" role="alert">{msg}</p>}
    </div>
  );
}
