import { after } from 'next/server';
import { encounterByToken } from '@/lib/auth';
import { db, isUniqueViolation } from '@/lib/db';
import { addEvent, insertSource, putBlob, SOURCE_COLS } from '@/lib/repo';
import { sha256Hex } from '@/lib/hash';
import { processPage } from '@/lib/pipeline/page';
import { HttpError, json, route } from '@/lib/http';
import type { Source } from '@/lib/types';

export const maxDuration = 120;
const MAX_BYTES = 4_500_000; // Vercel request-body limit; the kiosk compresses photos well below this.
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Upload one page photo. The same file twice in one encounter returns the existing source (no duplicate facts). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const enc = await encounterByToken((await ctx.params).token);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Expected a photo upload.');
  }
  const file = form.get('image');
  if (!(file instanceof File)) throw new HttpError(400, 'Expected a photo in the "image" field.');
  if (!TYPES.has(file.type)) throw new HttpError(415, 'Please upload a JPEG, PNG or WEBP photo.');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'Photo is larger than 4.5 MB. Please retake or compress it.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = sha256Hex(bytes);
  const d = await db();

  const existing = await d.query<Source>(`select ${SOURCE_COLS} from sources where encounter_id = $1 and sha256 = $2`, [enc.id, sha]);
  if (existing[0]) return json({ source: pub(existing[0]), duplicate: true });

  const blobId = await putBlob(d, enc.id, file.type, bytes);
  let src: Source;
  try {
    src = await insertSource(d, { encounter_id: enc.id, kind: 'page', label_prefix: 'p', blob_id: blobId, mime: file.type, sha256: sha, mode: enc.mode });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const again = await d.query<Source>(`select ${SOURCE_COLS} from sources where encounter_id = $1 and sha256 = $2`, [enc.id, sha]);
    if (!again[0]) throw e;
    return json({ source: pub(again[0]), duplicate: true });
  }
  await addEvent(d, { encounter_id: enc.id, actor: 'patient', role: 'patient', type: 'page_uploaded', payload: { source_id: src.id, sha256: sha, bytes: bytes.byteLength, mode: enc.mode } });
  after(() => processPage(src.id));
  return json({ source: pub(src), duplicate: false }, 201);
});

function pub(s: Source) {
  return { id: s.id, label: s.label, status: s.status, readability: s.readability, identity: s.identity, error: s.error, seq: s.seq };
}
