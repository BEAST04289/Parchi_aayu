'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, ApiError, timeHM } from '@/lib/client';

type Lang = 'hi' | 'en';
type Step = 'start' | 'tell' | 'papers' | 'check' | 'done';
interface KState {
  encounter: { alias: string; patient_name: string; language: Lang; status: 'intake' | 'paused_urgent' | 'ready'; intake_started: boolean; intake_completed: boolean };
  pages: { id: string; label: string; status: string; readability: string; identity: string; error: string | null; seq: number }[];
  answers: { id: string; label: string; kind: string; text: string | null; supersedes_id: string | null; created_at: string }[];
  open_alert: { id: string; requested_at: string; delivered: boolean; acked: boolean; acked_by: string | null } | null;
  server_time: string;
}

const T = {
  help: { hi: 'तबीयत बहुत खराब है? अभी स्टाफ को बताएं।', en: 'Feeling very unwell? Tell the staff now.' },
  stages: { hi: ['बताइए', 'पर्चे जोड़ें', 'जाँचें'], en: ['Tell us', 'Add papers', 'Check'] },
  consent: { hi: 'आपकी बातें और पर्चे डॉक्टर से मिलने से पहले क्लिनिक स्टाफ को दिखाए जाएँगे।', en: 'What you tell us and your papers will be shown to the clinic staff before you see the doctor.' },
  begin: { hi: 'शुरू करें', en: 'Start' },
  ask: { hi: 'आज आपको क्या परेशानी है?', en: 'What problem brings you here today?' },
  askSub: { hi: 'लिखकर बताइए। (आवाज़ से बताने की सुविधा अभी जोड़ी जा रही है।)', en: 'Type your answer. (Speaking is being added.)' },
  placeholder: { hi: 'अपनी बात यहाँ लिखें…', en: 'Write here…' },
  send: { hi: 'भेजें', en: 'Send' },
  readback: { hi: 'आपने लिखा:', en: 'You wrote:' },
  ok: { hi: 'सही है', en: "That's right" },
  edit: { hi: 'बदलें', en: 'Change' },
  save: { hi: 'सेव करें', en: 'Save' },
  papers: { hi: 'अपने पर्चे और रिपोर्ट की फोटो लीजिए।', en: 'Please take photos of your prescriptions and reports.' },
  camera: { hi: 'फोटो लें', en: 'Take photo' },
  gallery: { hi: 'गैलरी से चुनें', en: 'Choose from gallery' },
  skip: { hi: 'अभी पर्चे नहीं हैं — आगे बढ़ें', en: 'No papers now — continue' },
  next: { hi: 'आगे बढ़ें', en: 'Continue' },
  check: { hi: 'एक बार देख लीजिए, सब सही है?', en: 'Please check: is everything correct?' },
  finish: { hi: 'पूरा करें', en: 'Finish' },
  done: { hi: 'आपकी जानकारी स्टाफ के देखने के लिए तैयार है। कृपया अपनी बारी का इंतज़ार करें।', en: 'Your information is ready for staff review. Please wait for your turn.' },
  retry: { hi: 'फिर से कोशिश करें', en: 'Try again' },
  nearby: { hi: 'अगर कोई तुरंत न आए, तो पास के स्टाफ को अभी बताएं।', en: 'If no one comes right away, tell nearby staff now.' },
  offline: { hi: 'नेटवर्क नहीं है। कृपया पास के स्टाफ को अभी बताएं।', en: 'No network. Please tell nearby staff now.' },
  reqStored: { hi: 'आपका अनुरोध दर्ज हो गया है। स्टाफ की स्क्रीन तक पहुँचाया जा रहा है।', en: 'Your request is recorded and is being sent to the staff screen.' },
  reqDelivered: { hi: 'आपका अनुरोध स्टाफ की स्क्रीन पर पहुँच गया है।', en: 'Your request has reached the staff screen.' },
  reqAcked: { hi: 'स्टाफ ने आपका अनुरोध देख लिया है।', en: 'Staff acknowledged your request.' },
  paused: { hi: 'जानकारी भरना रोक दिया गया है। स्टाफ इसे फिर से शुरू करेंगे।', en: 'Intake is paused. Staff will resume it.' },
};

const PAGE_LABEL: Record<string, { hi: string; en: string }> = {
  sending: { hi: 'भेजा जा रहा है', en: 'sending' },
  uploaded: { hi: 'भेजा गया', en: 'received' },
  processing: { hi: 'पढ़ा जा रहा है', en: 'reading' },
  done: { hi: 'पढ़ लिया', en: 'read' },
  partial: { hi: 'कुछ हिस्सा पढ़ा', en: 'partly read' },
  unreadable: { hi: 'दोबारा फोटो लें', en: 'needs retake' },
  failed: { hi: 'प्रोसेस नहीं हो पाया', en: 'processing failed' },
  identity: { hi: 'पहचान जाँच', en: 'identity check' },
  upload_failed: { hi: 'भेजा नहीं जा सका', en: 'upload failed' },
};

async function compress(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('compress failed'))), 'image/jpeg', 0.85));
}

export default function Kiosk({ token }: { token: string }) {
  const [st, setSt] = useState<KState | null>(null);
  const [lang, setLang] = useState<Lang>('hi');
  const [step, setStep] = useState<Step>('start');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [netDown, setNetDown] = useState(false);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [helpState, setHelpState] = useState<'idle' | 'sending' | 'failed'>('idle');
  const t = (k: keyof typeof T) => (T[k] as { hi: string; en: string })[lang];
  const base = `/api/kiosk/${token}`;

  const refresh = useCallback(async () => {
    try {
      const s = await api<KState>(`${base}/state`);
      setSt(s); setNetDown(false); setLastOk(s.server_time); setLoadErr(null);
      return s;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setLoadErr('यह लिंक मान्य नहीं है। / This link is not valid.');
      else setNetDown(true);
      return null;
    }
  }, [base]);

  useEffect(() => {
    // Initial fetch; state is set asynchronously when the response arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().then((s) => {
      if (!s) return;
      setLang(s.encounter.language);
      const saved = typeof window !== 'undefined' ? sessionStorage.getItem(`parchi-step-${token}`) as Step | null : null;
      setStep(s.encounter.intake_completed ? 'done' : saved ?? (s.encounter.intake_started ? 'tell' : 'start'));
    });
    const iv = setInterval(refresh, 2000);
    return () => clearInterval(iv);
  }, [refresh, token]);

  const go = (s: Step) => { setStep(s); try { sessionStorage.setItem(`parchi-step-${token}`, s); } catch { /* private mode */ } window.scrollTo(0, 0); };

  const requestHelp = async () => {
    setHelpState('sending');
    try { await api(`${base}/help`, { method: 'POST' }); setHelpState('idle'); await refresh(); }
    catch { setHelpState('failed'); }
  };

  if (loadErr) return <main className="mx-auto max-w-[680px] p-6 text-[20px]">{loadErr}</main>;
  if (!st) return <main className="mx-auto max-w-[680px] p-6 text-[20px] deva">{netDown ? T.offline.hi : 'लोड हो रहा है…'}</main>;

  const paused = st.encounter.status === 'paused_urgent' || !!st.open_alert;
  const stageIdx = step === 'tell' ? 0 : step === 'papers' ? 1 : step === 'check' ? 2 : -1;

  return (
    <div className={clsx('min-h-screen pb-28', lang === 'hi' && 'deva')} lang={lang}>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-[680px] items-center gap-2">
          <span className="text-[20px] font-semibold text-teal">parchi</span>
          <span className="text-[15px] text-ink-2">{st.encounter.alias}</span>
          <div className="ml-auto flex rounded-[12px] border border-line text-[15px]">
            <button onClick={() => setLang('hi')} className={clsx('px-3 py-1.5 deva', lang === 'hi' && 'rounded-[12px] bg-teal text-white')} aria-pressed={lang === 'hi'}>हिंदी</button>
            <button onClick={() => setLang('en')} className={clsx('px-3 py-1.5', lang === 'en' && 'rounded-[12px] bg-teal text-white')} aria-pressed={lang === 'en'}>English</button>
          </div>
        </div>
        <div className="mx-auto mt-2 max-w-[680px]">
          <button onClick={requestHelp} disabled={helpState === 'sending'} data-testid="help"
            className="w-full rounded-[12px] border-2 border-red bg-red-soft px-3 py-2.5 text-left text-[18px] font-semibold text-red">
            {t('help')}
          </button>
          {helpState === 'failed' && !paused && <HelpFailed text={t('offline')} retry={t('retry')} onRetry={requestHelp} />}
        </div>
        {stageIdx >= 0 && !paused && (
          <ol className="mx-auto mt-2 flex max-w-[680px] gap-2 text-[15px]" aria-label="Steps">
            {T.stages[lang].map((s, i) => <li key={s} className={clsx('rounded-full px-3 py-0.5', i === stageIdx ? 'bg-teal text-white' : 'bg-page text-ink-2')} aria-current={i === stageIdx ? 'step' : undefined}>{i + 1}. {s}</li>)}
          </ol>
        )}
      </header>

      <main className="mx-auto max-w-[680px] px-4 pt-5 text-[20px] leading-[1.5]">
        {paused ? (
          <UrgentWait st={st} t={t} netDown={netDown} lastOk={lastOk} helpFailed={helpState === 'failed'} onRetry={requestHelp} />
        ) : step === 'start' ? (
          <Start t={t} lang={lang} setLang={setLang} onStart={async () => { try { await api(`${base}/start`, { method: 'POST', json: { language: lang } }); go('tell'); } catch (e) { alert((e as Error).message); } }} />
        ) : step === 'tell' ? (
          <Tell t={t} base={base} answers={st.answers} onNext={() => go('papers')} refresh={refresh} />
        ) : step === 'papers' ? (
          <Papers t={t} lang={lang} base={base} pages={st.pages} onNext={() => go('check')} refresh={refresh} />
        ) : step === 'check' ? (
          <Check t={t} lang={lang} base={base} st={st} onEdit={() => go('tell')} onPapers={() => go('papers')} onDone={() => go('done')} />
        ) : (
          <p className="rounded-[12px] border border-teal bg-teal-soft p-4 text-[22px]" data-testid="done">{t('done')}</p>
        )}
        {netDown && !paused && <p className="mt-4 rounded-[12px] bg-amber-soft p-3 text-amber">{t('offline')}</p>}
      </main>
    </div>
  );
}

function HelpFailed({ text, retry, onRetry }: { text: string; retry: string; onRetry: () => void }) {
  return (
    <div className="mt-2 rounded-[12px] bg-red px-3 py-2 text-[18px] font-semibold text-white" role="alert" data-testid="help-failed">
      {text} <button onClick={onRetry} className="ml-2 rounded bg-white px-2 py-0.5 text-[15px] text-red">{retry}</button>
    </div>
  );
}

function UrgentWait({ st, t, netDown, lastOk, helpFailed, onRetry }: { st: KState; t: (k: keyof typeof T) => string; netDown: boolean; lastOk: string | null; helpFailed: boolean; onRetry: () => void }) {
  const a = st.open_alert;
  return (
    <section className="rounded-[12px] border-2 border-red bg-surface p-5" data-testid="urgent-wait" aria-live="assertive">
      <p className="text-[24px] font-semibold" data-testid="urgent-status">{!a ? t('reqStored') : a.acked ? t('reqAcked') : a.delivered ? t('reqDelivered') : t('reqStored')}</p>
      <p className="mt-3 text-[20px] font-semibold text-red">{t('nearby')}</p>
      <p className="mt-3 text-[17px] text-ink-2">{t('paused')}</p>
      {(netDown || helpFailed) && <HelpFailed text={t('offline')} retry={t('retry')} onRetry={onRetry} />}
      {netDown && lastOk && <p className="mt-2 text-[15px] text-ink-2">Last update {timeHM(lastOk)}</p>}
    </section>
  );
}

function Start({ t, lang, setLang, onStart }: { t: (k: keyof typeof T) => string; lang: Lang; setLang: (l: Lang) => void; onStart: () => void }) {
  return (
    <section className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setLang('hi')} className={clsx('min-h-[64px] rounded-[12px] border-2 text-[22px] deva', lang === 'hi' ? 'border-teal bg-teal-soft' : 'border-line bg-surface')}>हिंदी</button>
        <button onClick={() => setLang('en')} className={clsx('min-h-[64px] rounded-[12px] border-2 text-[22px]', lang === 'en' ? 'border-teal bg-teal-soft' : 'border-line bg-surface')}>English</button>
      </div>
      <p>{t('consent')}</p>
      <BottomBar><button onClick={onStart} className="min-h-[56px] w-full rounded-[12px] bg-teal text-[22px] font-semibold text-white">{t('begin')}</button></BottomBar>
    </section>
  );
}

function Tell({ t, base, answers, onNext, refresh }: { t: (k: keyof typeof T) => string; base: string; answers: KState['answers']; onNext: () => void; refresh: () => Promise<unknown> }) {
  const current = answers.filter((a) => !answers.some((b) => b.supersedes_id === a.id));
  const last = current[current.length - 1];
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api(`${base}/answers`, { method: 'POST', json: { text, supersedes_id: editing } });
      setText(''); setEditing(null); await refresh();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  if (last && editing === null && !text) {
    return (
      <section className="grid gap-3" data-testid="readback">
        <h1 className="text-[28px] font-semibold">{t('readback')}</h1>
        <p className="rounded-[12px] border border-line bg-surface p-4 text-[22px]" data-testid="readback-text">{last.text}</p>
        <BottomBar>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setEditing(last.id); setText(last.text ?? ''); setTimeout(() => area.current?.focus(), 0); }} className="min-h-[56px] rounded-[12px] border-2 border-line bg-surface text-[20px]">{t('edit')}</button>
            <button onClick={onNext} className="min-h-[56px] rounded-[12px] bg-teal text-[20px] font-semibold text-white">{t('ok')}</button>
          </div>
        </BottomBar>
      </section>
    );
  }
  return (
    <section className="grid gap-3">
      <h1 className="text-[30px] font-semibold leading-tight">{t('ask')}</h1>
      <p className="text-ink-2">{t('askSub')}</p>
      <label className="sr-only" htmlFor="answer">{t('ask')}</label>
      <textarea id="answer" ref={area} value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={t('placeholder')}
        className="w-full rounded-[12px] border-2 border-line bg-surface p-3 text-[20px]" data-testid="answer-input" />
      {err && <p className="rounded-[12px] bg-red-soft p-3 text-red" role="alert">{err}</p>}
      <BottomBar>
        <button onClick={submit} disabled={busy || !text.trim()} className="min-h-[56px] w-full rounded-[12px] bg-teal text-[22px] font-semibold text-white disabled:opacity-50" data-testid="answer-send">{editing ? t('save') : t('send')}</button>
      </BottomBar>
    </section>
  );
}

interface LocalPage { key: string; url: string; status: 'sending' | 'sent' | 'upload_failed'; id?: string; err?: string; bytes?: number }

function Papers({ t, lang, base, pages, onNext, refresh }: { t: (k: keyof typeof T) => string; lang: Lang; base: string; pages: KState['pages']; onNext: () => void; refresh: () => Promise<unknown> }) {
  const [local, setLocal] = useState<LocalPage[]>([]);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      const url = URL.createObjectURL(f);
      setLocal((l) => [...l, { key, url, status: 'sending' }]);
      try {
        const blob = await compress(f);
        const fd = new FormData();
        fd.append('image', new File([blob], 'page.jpg', { type: 'image/jpeg' }));
        const r = await api<{ source: { id: string } }>(`${base}/pages`, { method: 'POST', body: fd });
        setLocal((l) => l.map((x) => (x.key === key ? { ...x, status: 'sent', id: r.source.id, bytes: blob.size } : x)));
      } catch (e) {
        setLocal((l) => l.map((x) => (x.key === key ? { ...x, status: 'upload_failed', err: (e as Error).message } : x)));
      }
    }
    await refresh();
  };
  const statusOf = (p: KState['pages'][number]) => p.status === 'done' ? (p.identity === 'withheld' ? 'identity' : p.readability === 'unreadable' ? 'unreadable' : p.readability === 'partial' ? 'partial' : 'done') : p.status;
  const read = pages.filter((p) => p.status === 'done').length;
  const busy = pages.filter((p) => p.status === 'uploaded' || p.status === 'processing').length;
  const failed = pages.filter((p) => p.status === 'failed').length;
  return (
    <section className="grid gap-4">
      <h1 className="text-[28px] font-semibold">{t('papers')}</h1>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => camRef.current?.click()} className="min-h-[72px] rounded-[12px] border-2 border-teal bg-surface text-[20px] font-semibold text-teal">{t('camera')}</button>
        <button onClick={() => galRef.current?.click()} className="min-h-[72px] rounded-[12px] border-2 border-teal bg-surface text-[20px] font-semibold text-teal">{t('gallery')}</button>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} data-testid="camera-input" />
        <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} data-testid="gallery-input" />
      </div>
      {pages.length > 0 && (
        <p className="text-[18px]" data-testid="page-coverage">
          {lang === 'hi' ? `${pages.length} पन्ने · ${read} पढ़ लिए${busy ? ` · ${busy} पढ़े जा रहे हैं` : ''}${failed ? ` · ${failed} प्रोसेस नहीं हुए` : ''}` : `${pages.length} pages · ${read} read${busy ? ` · ${busy} reading` : ''}${failed ? ` · ${failed} not processed` : ''}`}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {local.filter((l) => l.status !== 'sent').map((l) => (
          <li key={l.key} className="rounded-[12px] border border-line bg-surface p-2">
            <img src={l.url} alt="" className="h-28 w-full rounded object-cover" />
            <div className={clsx('mt-1 text-[16px]', l.status === 'upload_failed' && 'text-red')}>{PAGE_LABEL[l.status][lang]}</div>
            {l.err && <div className="text-[14px] text-red">{l.err}</div>}
          </li>
        ))}
        {pages.map((p) => {
          const loc = local.find((l) => l.id === p.id);
          const s = statusOf(p);
          return (
            <li key={p.id} className="rounded-[12px] border border-line bg-surface p-2" data-testid="page-thumb">
              {loc ? (<img src={loc.url} alt="" className="h-28 w-full rounded object-cover" />) : <div className="flex h-28 items-center justify-center rounded bg-page text-ink-2">{p.label}</div>}
              <div className={clsx('mt-1 text-[16px]', (s === 'failed' || s === 'unreadable') && 'text-amber')} data-testid="page-status">{p.label} · {PAGE_LABEL[s]?.[lang] ?? s}</div>
              {p.status === 'failed' && (
                <>
                  <div className="text-[13px] text-ink-2">{p.error}</div>
                  <button onClick={async () => { try { await api(`${base}/pages/${p.id}/retry`, { method: 'POST' }); } catch (e) { alert((e as Error).message); } await refresh(); }} className="mt-1 rounded border border-line px-2 py-0.5 text-[15px]">{t('retry')}</button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <BottomBar>
        <button onClick={onNext} className="min-h-[56px] w-full rounded-[12px] bg-teal text-[20px] font-semibold text-white" data-testid="papers-next">{pages.length || local.length ? t('next') : t('skip')}</button>
      </BottomBar>
    </section>
  );
}

function Check({ t, lang, base, st, onEdit, onPapers, onDone }: { t: (k: keyof typeof T) => string; lang: Lang; base: string; st: KState; onEdit: () => void; onPapers: () => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = st.answers.filter((a) => !st.answers.some((b) => b.supersedes_id === a.id));
  const unresolved = st.pages.filter((p) => p.status === 'failed' || p.readability === 'unreadable').length;
  return (
    <section className="grid gap-3">
      <h1 className="text-[28px] font-semibold">{t('check')}</h1>
      {current.length === 0 && <p className="text-ink-2">{lang === 'hi' ? 'आपने अभी कुछ नहीं लिखा है।' : 'You have not written anything yet.'}</p>}
      {current.map((a) => (
        <div key={a.id} className="flex items-start justify-between gap-3 rounded-[12px] border border-line bg-surface p-3">
          <p className="text-[20px]">{a.text}</p>
          <button onClick={onEdit} className="shrink-0 rounded-[12px] border border-line px-3 py-1 text-[17px]">{t('edit')}</button>
        </div>
      ))}
      <div className="flex items-center justify-between rounded-[12px] border border-line bg-surface p-3">
        <span>{lang === 'hi' ? `पर्चे: ${st.pages.length}` : `Papers: ${st.pages.length}`}{unresolved ? (lang === 'hi' ? ` · ${unresolved} अधूरे` : ` · ${unresolved} unresolved`) : ''}</span>
        <button onClick={onPapers} className="rounded-[12px] border border-line px-3 py-1 text-[17px]">{t('edit')}</button>
      </div>
      {err && <p className="rounded-[12px] bg-red-soft p-3 text-red" role="alert">{err}</p>}
      <BottomBar>
        <button disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await api(`${base}/complete`, { method: 'POST' }); onDone(); } catch (e) { setErr((e as Error).message); } setBusy(false); }}
          className="min-h-[56px] w-full rounded-[12px] bg-teal text-[22px] font-semibold text-white" data-testid="finish">{t('finish')}</button>
      </BottomBar>
    </section>
  );
}

function BottomBar({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur"><div className="mx-auto max-w-[680px]">{children}</div></div>;
}
