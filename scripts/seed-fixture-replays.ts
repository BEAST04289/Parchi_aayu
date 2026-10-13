/**
 * Seeds FIXTURE REPLAY rows for the six typeset synthetic pages in fixtures/, keyed by each PNG's exact
 * sha256. These are HAND-AUTHORED from fixtures/packet.json and fixtures/gold.json, not recorded
 * provider output, and the model field says so. They carry no word positions, so every reading falls
 * back to page-level evidence and "pending source check". A later LIVE run of the same file overwrites
 * its row with real recorded output.
 *
 * Local PGlite: stop the dev/prod server first (single-process database). Supabase: set DATABASE_URL.
 * Run: npx tsx scripts/seed-fixture-replays.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const packet = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/packet.json'), 'utf8'));
const gold = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/gold.json'), 'utf8'));
const LABEL = 'hand-authored fixture (not a provider output)';
const KIND: Record<string, string> = {
  medicine_name: 'med_name', medicine_strength: 'med_strength', medicine_frequency: 'med_frequency', medicine_form: 'med_form',
  allergy_substance: 'allergy', allergy_reaction: 'allergy_reaction',
  lab_name: 'lab_name', lab_value: 'lab_value', lab_unit: 'lab_unit', lab_reference_range: 'lab_range',
};

function rowsFor() {
  return packet.pages.map((p: { id: string; page: number; kind: string; clinic: string; date_display: string; title: string; lines: string[] }) => {
    const file = path.join(root, 'fixtures', `page-${String(p.page).padStart(2, '0')}.png`);
    const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const text = [p.clinic, p.title, p.date_display, ...p.lines].join('\n');
    // Word list without positions: [0,0,0,0] is invalid by design -> page-level evidence.
    const words = text.split(/\s+/).filter(Boolean).map((w, i) => ({ i, text: w, conf: 0.99, box: [0, 0, 0, 0], start: 0, end: 0 }));
    const items = gold.fields
      .filter((g: { source_id: string; field: string; expected_value: string | null }) => g.source_id === p.id && KIND[g.field] && g.expected_value)
      .map((g: { field: string; expected_value: string; evidence_quote: string; temporality?: string }) => ({
        group: 1, kind: KIND[g.field], value: g.expected_value, ocr_quote: g.evidence_quote, illegible: false,
        subject: 'patient', assertion: 'present', temporality: p.kind === 'prescription' ? 'historical' : 'unknown',
      }));
    const extraction = { doc_type: p.kind, clinic: p.clinic, doc_date_raw: p.date_display, name_on_doc: 'Ramesh', age_on_doc: '52 years', id_on_doc: 'SYN-R52', items };
    return { sha, page: p.page, result: { ocr: { text, words, width: null, height: null }, extraction } };
  });
}

async function main() {
  const rows = rowsFor();
  const sql = `insert into replays (sha256, kind, result, model) values ($1, 'page', $2, $3)
               on conflict (sha256) do update set result = excluded.result, model = excluded.model, recorded_at = now()
               where replays.model = $3`; // never overwrite a real recorded result
  if (process.env.DATABASE_URL) {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    for (const r of rows) await c.query(sql, [r.sha, JSON.stringify(r.result), LABEL]);
    await c.end();
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = path.join(root, '.data', 'pglite');
    fs.mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
    for (const r of rows) await db.query(sql, [r.sha, JSON.stringify(r.result), LABEL]);
    await db.close();
  }
  for (const r of rows) console.log(`page ${r.page}  ${r.sha.slice(0, 12)}…  items=${r.result.extraction.items.length}`);
  console.log(`Seeded ${rows.length} fixture replay rows (${LABEL}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
