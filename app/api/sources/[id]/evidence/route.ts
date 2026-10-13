import { requireStaff } from '@/lib/auth';
import { db } from '@/lib/db';
import { getSource } from '@/lib/repo';
import { dateLabel } from '@/lib/verify/dates';
import { assertUuid, HttpError, json, route } from '@/lib/http';
import type { Fact, Source } from '@/lib/types';

/** Evidence for the drawer. The file itself is fetched from /api/sources/[id]/file with the same staff session. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const id = assertUuid((await ctx.params).id, 'source');
  const s = await getSource(id);
  if (!s) throw new HttpError(404, 'Source unavailable.');
  const d = await db();
  const facts = await d.query<Fact>('select * from facts where source_id = $1 order by created_at, id', [id]);
  // Answer history: the corrected version and every earlier version it supersedes.
  const chain: Pick<Source, 'id' | 'label' | 'kind' | 'typed_text' | 'transcript_hi' | 'transcript_en' | 'created_at'>[] = [];
  let cur: string | null = s.supersedes_id;
  while (cur && chain.length < 10) {
    const p = await getSource(cur);
    if (!p) break;
    chain.push({ id: p.id, label: p.label, kind: p.kind, typed_text: p.typed_text, transcript_hi: p.transcript_hi, transcript_en: p.transcript_en, created_at: p.created_at });
    cur = p.supersedes_id;
  }
  return json({
    source: {
      id: s.id, kind: s.kind, label: s.label, mime: s.mime, status: s.status, error: s.error, mode: s.mode, model: s.model,
      doc_type: s.doc_type, clinic: s.clinic, date_label: dateLabel(s.doc_date), doc_date_raw: s.doc_date?.raw ?? null,
      identity: s.identity, name_on_doc: s.name_on_doc, readability: s.readability, width: s.width, height: s.height,
      typed_text: s.typed_text, transcript_hi: s.transcript_hi, transcript_en: s.transcript_en, translation_by: s.translation_by,
      created_at: s.created_at, has_file: !!s.blob_id, file_url: s.blob_id ? `/api/sources/${s.id}/file` : null,
    },
    facts: facts.map((f) => ({ id: f.id, kind: f.kind, value: f.value, value_en: f.value_en, quote: f.quote, anchor: f.anchor, evidence: f.evidence, check_state: f.check_state, reasons: f.reasons, created_by: f.created_by, created_at: f.created_at, supersedes_id: f.supersedes_id, superseded_by: f.superseded_by })),
    history: chain,
  });
});
