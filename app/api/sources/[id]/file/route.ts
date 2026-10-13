import { requireStaffOrDemo } from '@/lib/auth';
import { getBlob, getSource } from '@/lib/repo';
import { assertUuid, HttpError, route } from '@/lib/http';

/** Original page photo / answer clip. Staff session required; never a public URL. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = assertUuid((await ctx.params).id, 'source');
  const s = await getSource(id);
  // Staff, or the demo viewer of this source's encounter; everyone else gets 401 whether or not it exists.
  await requireStaffOrDemo(s?.encounter_id ?? null);
  if (!s || !s.blob_id) throw new HttpError(404, 'Source unavailable.');
  const blob = await getBlob(s.blob_id);
  if (!blob || blob.encounter_id !== s.encounter_id) throw new HttpError(404, 'Source unavailable.');
  return new Response(new Uint8Array(blob.data), {
    headers: { 'Content-Type': blob.mime, 'Content-Length': String(blob.data.byteLength), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
});
