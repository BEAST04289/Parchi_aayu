import { after } from 'next/server';
import { requireStaffOrDemo } from '@/lib/auth';
import { kickQueue } from '@/lib/pipeline/page';
import { loadBundle } from '@/lib/repo';
import { buildBrief } from '@/lib/brief/build';
import { assertUuid, json, route } from '@/lib/http';
import { SECTION_KEYS, type RevInfo, type SectionKey } from '@/lib/types';

export const maxDuration = 120;

/** Cheap poll target: clinical revision + per-section hashes, and a separate live-status hash. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = assertUuid((await ctx.params).id, 'encounter');
  await requireStaffOrDemo(id);
  const b = buildBrief(await loadBundle(id));
  after(() => kickQueue(id));
  const info: RevInfo = {
    revision: b.revision,
    live_hash: b.live_hash,
    section_hashes: Object.fromEntries(SECTION_KEYS.map((k) => [k, b.sections[k].hash])) as Record<SectionKey, string>,
  };
  return json(info);
});
