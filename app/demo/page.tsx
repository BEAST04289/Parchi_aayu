'use client';
import { useCallback, useEffect, useState } from 'react';
import BriefView from '@/components/staff/BriefView';
import EvidenceDrawer from '@/components/staff/EvidenceDrawer';
import { api } from '@/lib/client';
import { Brand } from '@/components/staff/ui';

/** Public, read-only demonstration of the clinician brief for one synthetic patient. No login. */
export default function DemoPage() {
  const [id, setId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ sourceId: string; factId: string | null; trigger: HTMLElement | null } | null>(null);
  useEffect(() => {
    api<{ encounter_id: string }>('/api/demo/session', { method: 'POST' }).then((r) => setId(r.encounter_id)).catch((e) => setErr((e as Error).message));
  }, []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="border-b border-line/70 bg-surface px-4 py-3 shadow-card">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-2">
          <Brand suffix="clinician brief demo" />
          <a href="/staff" className="rounded-full bg-ink px-4 py-2 text-[15px] font-semibold text-white shadow-card hover:shadow-lift">Staff sign-in →</a>
        </div>
        <p className="mx-auto mt-3 max-w-[1100px] rounded-xl border border-amber/30 bg-amber-soft px-4 py-2.5 text-[14px] text-amber" data-testid="demo-label">
          Synthetic demonstration: Ramesh, 52 is a fictional patient. These pages were processed earlier and are replayed from
          hand-authored fixture readings (FIXTURE REPLAY), not live AI output. Read-only: review and source-check actions need a staff login.
          Click any [p1]–[p6] chip or page thumbnail to open the original page with its readings.
        </p>
        <a href="/staff" data-testid="full-experience"
          className="mx-auto mt-3 flex min-h-[56px] max-w-[1100px] flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-ink px-5 py-4 text-white shadow-lift hover:-translate-y-0.5">
          <span>
            <span className="block text-[18px] font-semibold">Try the full experience: patient kiosk + doctor and nurse screens</span>
            <span className="block text-[14px] opacity-90">The passcode is shown on the sign-in page. Open any patient, then click &ldquo;Show patient kiosk side-by-side&rdquo;.</span>
          </span>
          <span className="rounded-full bg-surface px-5 py-2 text-[16px] font-semibold text-ink shadow-card">Sign in as staff →</span>
        </a>
      </header>
      {err && <p className="mx-auto max-w-[1100px] p-6 text-red">Demo unavailable: {err}</p>}
      {!id && !err && <p className="mx-auto max-w-[1100px] p-6 text-ink-2">Loading demo…</p>}
      {id && <BriefView key={id} encounterId={id} role="doctor" readOnly onOpen={(sourceId, factId, trigger) => setDrawer({ sourceId, factId: factId ?? null, trigger: trigger ?? null })} />}
      {drawer && <EvidenceDrawer key={`${drawer.sourceId}:${drawer.factId}`} sourceId={drawer.sourceId} factId={drawer.factId} onClose={closeDrawer} returnFocus={drawer.trigger} />}
    </div>
  );
}
