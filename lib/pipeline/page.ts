import 'server-only';
import { db } from '../db';
import { getBlob, addEvent } from '../repo';
import { DRUGS } from '../data';
import { verifyPageItems } from '../verify/page';
import { parseDocDate } from '../verify/dates';
import { checkIdentity } from '../verify/identity';
import { runVisionOcr } from './ocr';
import { extractPage, modelId, type PageExtraction } from './extract';
import { ProviderError } from './errors';
import type { Encounter, OcrPage, Source } from '../types';

const MAX_PARALLEL = 2;
/** A claim older than this was killed (e.g. by the platform's maxDuration) and no longer counts. */
const STALE_INTERVAL = '3 minutes';

/**
 * Claims a page (at most 2 fresh claims per encounter), runs OCR -> extraction -> verifier, and stores
 * facts in one transaction together with status 'done'. A failure stores zero facts and a readable
 * error. Waiting pages are started by kickQueue(), which the polled endpoints call; nothing chains
 * inside one invocation, so a killed invocation cannot strand the queue.
 */
export async function processPage(sourceId: string): Promise<void> {
  const d = await db();
  const claimed = await d.query<Source>(
    `update sources s set status = 'processing', error = null, processing_started_at = now()
     where s.id = $1 and s.kind = 'page' and s.status in ('uploaded','failed')
       and (select count(*) from sources o where o.encounter_id = s.encounter_id and o.status = 'processing'
            and o.processing_started_at > now() - interval '${STALE_INTERVAL}') < $2
     returning s.id, s.encounter_id, s.blob_id, s.mime, s.sha256, s.mode, s.label`,
    [sourceId, MAX_PARALLEL],
  );
  const src = claimed[0];
  if (!src) return;

  const t0 = Date.now();
  const timings: Record<string, number> = {};
  try {
    const [enc] = await d.query<Encounter>('select * from encounters where id = $1', [src.encounter_id]);
    const blob = src.blob_id ? await getBlob(src.blob_id) : null;
    if (!blob) throw new ProviderError('invalid_response', 'Stored file is missing.');

    let ocr: OcrPage;
    let extraction: PageExtraction;
    let model: string;
    if (src.mode === 'replay') {
      const rows = await d.query<{ result: { ocr: OcrPage; extraction: PageExtraction }; model: string }>('select result, model from replays where sha256 = $1 and kind = $2', [src.sha256, 'page']);
      if (!rows[0]) throw new ProviderError('replay_miss', 'No recorded result for this exact file (replay mode). Switch to LIVE to process it.');
      ({ ocr, extraction } = rows[0].result);
      model = `replay of ${rows[0].model}`;
    } else {
      const tOcr = Date.now();
      ocr = (await runVisionOcr(blob.data)).page;
      timings.ocr_ms = Date.now() - tOcr;
      const tEx = Date.now();
      extraction = await extractPage(blob.data, blob.mime, ocr.text, enc);
      timings.extract_ms = Date.now() - tEx;
      model = modelId();
    }

    const { kept, held_back } = verifyPageItems(extraction.items, ocr, DRUGS);
    timings.held_back = held_back.length;
    timings.total_ms = Date.now() - t0;
    const docDate = parseDocDate(extraction.doc_date_raw);
    const identity = checkIdentity(enc, { name: extraction.name_on_doc, age: extraction.age_on_doc, id: extraction.id_on_doc });
    const readability = kept.length === 0 && !ocr.text.trim() ? 'unreadable' : kept.some((k) => k.item.illegible) ? 'partial' : 'readable';

    await d.tx(async (q) => {
      for (const v of kept) {
        await q.query(
          `insert into facts (encounter_id, source_id, group_key, kind, value, quote, anchor, evidence, check_state, reasons, subject, assertion, temporality, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'system')`,
          [src.encounter_id, src.id, `${src.id}:g${v.item.group}`, v.item.kind, v.item.value.trim(), v.item.ocr_quote,
           v.boxes.length ? JSON.stringify({ boxes: v.boxes }) : null, v.evidence, v.check_state, v.reasons,
           v.item.subject, v.item.assertion, v.item.temporality],
        );
      }
      await q.query(
        `update sources set status = 'done', error = null, ocr = $2, doc_type = $3, clinic = $4, doc_date = $5, name_on_doc = $6, age_on_doc = $7,
           id_on_doc = $8, identity = $9, readability = $10, model = $11, timings = $12, width = $13, height = $14 where id = $1`,
        [src.id, JSON.stringify(ocr), extraction.doc_type, extraction.clinic, JSON.stringify(docDate), extraction.name_on_doc, extraction.age_on_doc,
         extraction.id_on_doc, identity, readability, model, JSON.stringify(timings), ocr.width, ocr.height],
      );
      await addEvent(q, { encounter_id: src.encounter_id, actor: 'system', role: 'system', type: 'page_processed', payload: { source_id: src.id, mode: src.mode, model, facts: kept.length, held_back: held_back.length } });
    });

    if (src.mode === 'live' && src.sha256) {
      await d.query(
        `insert into replays (sha256, kind, result, model) values ($1, 'page', $2, $3) on conflict (sha256) do update set result = excluded.result, model = excluded.model, recorded_at = now()`,
        [src.sha256, JSON.stringify({ ocr, extraction }), model],
      );
    }
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : 'Processing failed unexpectedly. Retry.';
    if (!(e instanceof ProviderError)) console.error('[processPage]', (e as Error).message);
    timings.total_ms = Date.now() - t0;
    await d.query(`update sources set status = 'failed', error = $2, timings = $3 where id = $1`, [src.id, msg, JSON.stringify(timings)]);
  }
}

/**
 * Called (via after()) by endpoints that are polled every 2 s. Marks interrupted claims as failed
 * (retryable) and starts the oldest waiting page if there is capacity. Duplicate kicks are harmless:
 * the claim in processPage is atomic.
 */
export async function kickQueue(encounterId: string): Promise<void> {
  const d = await db();
  await d.query(
    `update sources set status = 'failed', error = 'Processing was interrupted. Retry.'
     where encounter_id = $1 and kind = 'page' and status = 'processing' and processing_started_at < now() - interval '${STALE_INTERVAL}'`,
    [encounterId],
  );
  const next = await d.query<{ id: string }>(`select id from sources where encounter_id = $1 and kind = 'page' and status = 'uploaded' order by seq limit 1`, [encounterId]);
  if (next[0]) await processPage(next[0].id);
}
