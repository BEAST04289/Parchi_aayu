'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, ApiError, timeHM } from '@/lib/client';
import BriefView from './BriefView';
import { Brand } from './ui';
import EvidenceDrawer from './EvidenceDrawer';
import type { Encounter, StaffAlert, StaffRole } from '@/lib/types';

interface Me { name: string; role: StaffRole; actor: string; system: { db: 'supabase' | 'local'; providers: { ocr: { provider: string; configured: boolean }; extraction: { provider: string; configured: boolean } }; ml_ok: boolean; ollama_ok: boolean } }
type EncRow = Omit<Encounter, 'token'> & { open_alert: boolean };

export default function StaffApp({ demoPasscode = null }: { demoPasscode?: string | null }) {
  const [me, setMe] = useState<Me | null | 'out'>(null);
  const load = useCallback(() => api<Me>('/api/staff/me').then(setMe).catch(() => setMe('out')), []);
  useEffect(() => { load(); }, [load]);
  if (me === null) return <div className="p-6 text-ink-2">Loading…</div>;
  if (me === 'out') return <Login onDone={load} demoPasscode={demoPasscode} />;
  return <Workspace me={me} onLogout={async () => { await api('/api/staff/logout', { method: 'POST' }).catch(() => {}); setMe('out'); }} />;
}

function Login({ onDone, demoPasscode }: { onDone: () => void; demoPasscode: string | null }) {
  const [passcode, setPasscode] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('doctor');
  const [err, setErr] = useState<string | null>(null);
  return (
    <main className="mx-auto mt-16 max-w-[440px] rounded-2xl border border-line/70 bg-surface p-7 shadow-lift">
      <Brand suffix="Staff workspace" size="lg" />
      <p className="mt-1 text-[14px] text-ink-2">Synthetic demo. No real patient data.</p>
      {demoPasscode && (
        <div className="mt-3 rounded-md border border-teal bg-teal-soft p-3 text-[14px]" data-testid="demo-passcode">
          <div><strong>Judges:</strong> the demo staff passcode is <code className="select-all rounded bg-surface px-1.5 py-0.5 font-mono text-[15px]">{demoPasscode}</code></div>
          <button type="button" onClick={() => { setPasscode(demoPasscode); if (!name.trim()) setName('Judge'); }} className="mt-2 rounded-md border border-teal bg-surface px-3 py-1.5 font-medium text-teal hover:bg-page">Fill in for me</button>
        </div>
      )}
      <form className="mt-4 grid gap-3" onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        unlockAudio();
        try { await api('/api/staff/login', { method: 'POST', json: { passcode, name, role } }); onDone(); } catch (x) { setErr((x as Error).message); }
      }}>
        <label className="grid gap-1 text-[14px]">Staff passcode<input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} className="rounded border border-line px-3 py-2 text-[16px]" autoComplete="current-password" /></label>
        <label className="grid gap-1 text-[14px]">Your name<input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-line px-3 py-2 text-[16px]" placeholder="e.g. Sharma" /></label>
        <fieldset className="grid gap-1 text-[14px]">
          <legend>Demo roles</legend>
          <div className="flex gap-2">
            {(['doctor', 'nurse'] as const).map((r) => (
              <label key={r} className={clsx('flex-1 cursor-pointer rounded border px-3 py-2 text-center', role === r ? 'border-teal bg-teal-soft' : 'border-line')}>
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />{r === 'doctor' ? 'Doctor' : 'Nurse'}
              </label>
            ))}
          </div>
          <span className="text-[12px] text-ink-2">Anyone with the staff passcode can choose a role. This is a demo convenience, not production access control.</span>
        </fieldset>
        {err && <p className="rounded bg-red-soft p-2 text-red" role="alert">{err}</p>}
        <button className="rounded-md bg-teal px-4 py-2 font-medium text-white">Sign in</button>
      </form>
    </main>
  );
}

function Workspace({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [encs, setEncs] = useState<EncRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [side, setSide] = useState(false);
  const [drawer, setDrawer] = useState<{ sourceId: string; factId: string | null; trigger: HTMLElement | null } | null>(null);

  const loadEncs = useCallback(() => api<{ encounters: EncRow[] }>('/api/encounters').then((r) => setEncs(r.encounters)).catch(() => {}), []);
  useEffect(() => { loadEncs(); const t = setInterval(loadEncs, 4000); return () => clearInterval(t); }, [loadEncs]);
  const mode = encs.find((x) => x.id === sel)?.mode ?? 'live';

  const openSource = useCallback((sourceId: string, factId?: string | null, trigger?: HTMLElement | null) => setDrawer({ sourceId, factId: factId ?? null, trigger: trigger ?? null }), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const p = me.system.providers;
  const ocrLocal = p.ocr.provider.includes('local');

  return (
    <div className="flex min-h-screen flex-col">
      <AlertBar onOpenEncounter={(id) => setSel(id)} />
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/70 bg-surface/95 px-4 py-2.5 shadow-card backdrop-blur">
        <Brand suffix="Staff workspace" />
        {me.system.db === 'local' && <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-[12px] font-semibold tracking-wide text-amber ring-1 ring-amber/20" data-testid="local-db">LOCAL DEV DATABASE</span>}
        <span className="text-[13px] text-ink-2" data-testid="providers" title="Status when this page loaded">
          OCR: {p.ocr.provider}{ocrLocal ? (me.system.ml_ok ? ' ✓' : ' · not running') : p.ocr.configured ? ' ✓' : ' · not configured'} · Extraction: {p.extraction.provider}{p.extraction.provider.includes('Ollama') ? (me.system.ollama_ok ? ' ✓' : ' · not running') : p.extraction.configured ? ' ✓' : ' · not configured'}
        </span>
        {sel && (
          <div className="flex items-center gap-1 text-[13px]" aria-label="Processing mode for new uploads">
            {(['live', 'replay'] as const).map((m) => (
              <button key={m} onClick={async () => { try { await api(`/api/encounters/${sel}/mode`, { method: 'POST', json: { mode: m } }); await loadEncs(); } catch (e) { alert((e as Error).message); } }}
                className={clsx('rounded-full px-2.5 py-0.5 text-[12px] font-semibold tracking-wide', mode === m ? (m === 'live' ? 'bg-teal text-white shadow-card' : 'bg-amber text-white shadow-card') : 'border border-line text-ink-2 hover:bg-page')}>
                {m === 'live' ? 'LIVE' : 'FIXTURE REPLAY'}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 text-[14px]">
          <span className="rounded-full bg-page px-2.5 py-0.5 ring-1 ring-line" title="Demo role chosen at sign-in">Demo role: {me.role === 'doctor' ? 'Doctor' : 'Nurse'}</span>
          <span>{me.actor}</span>
          <button onClick={onLogout} className="rounded-full border border-line px-3 py-1 hover:bg-page">Sign out</button>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="w-[216px] shrink-0 border-r border-line/70 bg-surface p-3">
          <button onClick={() => setCreating(true)} className="mb-2 w-full rounded-lg bg-teal px-3 py-2.5 text-[14px] font-semibold text-white shadow-card hover:shadow-lift">+ Create encounter</button>
          <a href="/demo" className="mb-4 block w-full rounded-lg border border-teal/40 bg-teal-soft/50 px-3 py-2 text-center text-[14px] font-medium text-teal hover:border-teal hover:bg-teal-soft" data-testid="open-demo">View demo patient (read-only)</a>
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">Synthetic demo encounters</div>
          <ul className="grid gap-1">
            {encs.map((e) => (
              <li key={e.id}>
                <button onClick={() => { setSel(e.id); setCreating(false); }} className={clsx('w-full rounded-lg border-l-[3px] px-2.5 py-1.5 text-left', sel === e.id ? 'border-teal bg-teal-soft' : 'border-transparent hover:bg-page')} data-testid={`enc-${e.alias}`}>
                  <div className="flex items-center justify-between text-[14px] font-semibold"><span>{e.alias}</span>{e.open_alert && <span className="rounded bg-red px-1.5 text-[11px] text-white">HELP</span>}</div>
                  <div className="text-[13px] text-ink-2">{e.patient_name}{e.patient_age !== null ? `, ${e.patient_age}` : ''} · {e.status === 'ready' ? 'ready' : e.status === 'paused_urgent' ? 'paused' : 'intake'}</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <main className="min-w-0 flex-1">
          {creating ? <CreateEncounter onCreated={(id) => { loadEncs(); setSel(id); }} onClose={() => setCreating(false)} />
            : sel ? (
              <div className="flex min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="mx-auto flex max-w-[1100px] justify-end px-5 pt-3">
                    <button onClick={() => setSide((v) => !v)} className="rounded-md border border-teal px-3 py-1.5 text-[14px] font-medium text-teal hover:bg-teal-soft" data-testid="toggle-kiosk">
                      {side ? 'Hide patient kiosk' : 'Show patient kiosk side-by-side'}
                    </button>
                  </div>
                  <BriefView key={sel} encounterId={sel} role={me.role} onOpen={openSource} />
                </div>
                {side && <KioskSide key={sel} encounterId={sel} />}
              </div>
            )
              : <div className="p-8 text-ink-2"><p className="text-[18px] text-ink">No encounter selected.</p><p className="mt-1">Create an encounter, then open its kiosk link or QR code on the patient&apos;s device. The brief fills in as the patient types and uploads papers.</p></div>}
        </main>
      </div>
      {drawer && <EvidenceDrawer key={`${drawer.sourceId}:${drawer.factId}`} sourceId={drawer.sourceId} factId={drawer.factId} onClose={closeDrawer} returnFocus={drawer.trigger} />}
    </div>
  );
}

function CreateEncounter({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: string; alias: string; kiosk_url: string; qr_data_url: string } | null>(null);
  if (made) return (
    <div className="max-w-[640px] p-6" data-testid="created">
      <h2 className="text-[24px] font-semibold">Encounter {made.alias} created</h2>
      <p className="mt-1 text-ink-2">Scan on the patient device, or open the link there. Anyone with this link can add to this encounter only.</p>
      <img src={made.qr_data_url} alt="QR code for the kiosk link" className="mt-4 h-[240px] w-[240px] rounded border border-line" />
      <p className="mt-3 break-all rounded bg-surface p-2 font-mono text-[13px]" data-testid="kiosk-url">{made.kiosk_url}</p>
      <div className="mt-3 flex gap-2">
        <a href={made.kiosk_url} target="_blank" rel="noreferrer" className="rounded-md border border-line px-3 py-2">Open kiosk in a new tab</a>
        <button onClick={() => { onCreated(made.id); onClose(); }} className="rounded-md bg-teal px-3 py-2 text-white">Go to brief</button>
      </div>
    </div>
  );
  return (
    <form className="grid max-w-[420px] gap-3 p-6" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      try {
        const r = await api<{ encounter: { id: string; alias: string }; kiosk_url: string; qr_data_url: string }>('/api/encounters', { method: 'POST', json: { patient_name: name, patient_age: age, patient_ref: ref } });
        setMade({ id: r.encounter.id, alias: r.encounter.alias, kiosk_url: r.kiosk_url, qr_data_url: r.qr_data_url });
        onCreated(r.encounter.id);
      } catch (x) { setErr((x as Error).message); }
    }}>
      <h2 className="text-[24px] font-semibold">Create encounter</h2>
      <p className="text-[14px] text-ink-2">Staff record identity once; the patient is not asked to register again.</p>
      <label className="grid gap-1 text-[14px]">Patient name<input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-line px-3 py-2" required /></label>
      <label className="grid gap-1 text-[14px]">Age<input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" className="rounded border border-line px-3 py-2" /></label>
      <label className="grid gap-1 text-[14px]">Patient ID (optional)<input value={ref} onChange={(e) => setRef(e.target.value)} className="rounded border border-line px-3 py-2" /></label>
      {err && <p className="rounded bg-red-soft p-2 text-red" role="alert">{err}</p>}
      <div className="flex gap-2"><button className="rounded-md bg-teal px-4 py-2 text-white">Create</button><button type="button" onClick={onClose} className="rounded-md border border-line px-4 py-2">Cancel</button></div>
    </form>
  );
}

// ---------- Urgent alerts: polled for ALL encounters, on every staff screen ----------
let audioCtx: AudioContext | null = null;
function unlockAudio() {
  try { audioCtx = audioCtx ?? new AudioContext(); void audioCtx.resume(); } catch { /* no audio */ }
}
function chime() {
  try {
    if (!audioCtx || audioCtx.state !== 'running') return false;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.35);
    return true;
  } catch { return false; }
}

function AlertBar({ onOpenEncounter }: { onOpenEncounter: (id: string) => void }) {
  const [alerts, setAlerts] = useState<StaffAlert[]>([]);
  const [offline, setOffline] = useState<string | null>(null);
  const [soundOk, setSoundOk] = useState(true);
  const lastChime = useRef(0);
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await api<{ alerts: StaffAlert[] }>('/api/staff/alerts');
        setOffline(null);
        for (const a of r.alerts.filter((x) => !x.delivered_at)) await api(`/api/alerts/${a.id}/delivered`, { method: 'POST' }).catch(() => {});
        setAlerts(r.alerts);
        if (r.alerts.some((a) => !a.acked_at) && Date.now() - lastChime.current > 10_000) { lastChime.current = Date.now(); setSoundOk(chime()); }
      } catch (e) {
        setOffline(e instanceof ApiError && e.status === 0 ? 'Disconnected: alerts may not arrive. Check the network.' : (e as Error).message);
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);
  const act = async (id: string, action: 'ack' | 'resume') => {
    try { await api(`/api/alerts/${id}/${action}`, { method: 'POST' }); const r = await api<{ alerts: StaffAlert[] }>('/api/staff/alerts'); setAlerts(r.alerts); } catch (e) { alert((e as Error).message); }
  };
  if (!alerts.length && !offline) return null;
  return (
    <div role="alert" aria-live="assertive" data-testid="alert-bar">
      {offline && <div className="bg-amber px-4 py-1.5 text-[14px] font-medium text-white">{offline}</div>}
      {alerts.map((a) => (
        <div key={a.id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-2', a.acked_at ? 'bg-red-soft text-red' : 'bg-red text-white')} data-testid="alert-row">
          <strong className="text-[16px]">URGENT · {a.alias} · {a.patient_name}</strong>
          <span className="deva">{a.quote ? `patient said: “${a.quote}”` : 'Help requested from kiosk'}</span>
          <span className="text-[13px]">Requested {timeHM(a.requested_at)} · {a.acked_at ? `Acknowledged by ${a.acked_by} ${timeHM(a.acked_at)}` : 'Not yet acknowledged'}</span>
          <span className="ml-auto flex gap-2">
            <button onClick={() => onOpenEncounter(a.encounter_id)} className="rounded border border-current px-2 py-0.5 text-[14px]">Open {a.alias}</button>
            {!a.acked_at
              ? <button onClick={() => act(a.id, 'ack')} className="rounded bg-white px-3 py-0.5 text-[14px] font-semibold text-red">Acknowledge</button>
              : <button onClick={() => act(a.id, 'resume')} className="rounded bg-red px-3 py-0.5 text-[14px] font-semibold text-white">Resume intake</button>}
          </span>
          {!soundOk && !a.acked_at && <button onClick={() => { unlockAudio(); setSoundOk(chime()); }} className="text-[12px] underline">Enable alert sound</button>}
        </div>
      ))}
    </div>
  );
}

/** The patient's kiosk for this encounter, live beside the brief (same origin, real kiosk, real actions). */
function KioskSide({ encounterId }: { encounterId: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ kiosk_url: string }>(`/api/encounters/${encounterId}/kiosk-link`).then((r) => setPath(new URL(r.kiosk_url).pathname)).catch((e) => setErr((e as Error).message));
  }, [encounterId]);
  return (
    <aside className="sticky top-0 flex h-screen w-[410px] shrink-0 flex-col border-l border-line bg-page p-2" aria-label="Patient kiosk" data-testid="kiosk-side">
      <div className="mb-1 flex items-center justify-between text-[13px] text-ink-2">
        <span>Patient kiosk (what the patient sees)</span>
        {path && <a href={path} target="_blank" rel="noopener noreferrer" className="text-teal underline">Open in new tab</a>}
      </div>
      {err && <p className="text-red">Kiosk link unavailable: {err}</p>}
      {path && <iframe src={path} title="Patient kiosk" className="w-[390px] flex-1 rounded border border-line bg-surface" allow="camera; microphone" />}
    </aside>
  );
}
