import { requireStaff, staffActor } from '@/lib/auth';
import { dbKind } from '@/lib/db';
import { modelId } from '@/lib/pipeline/extract';
import { json, route } from '@/lib/http';

/** Who is signed in, plus which integrations are configured (booleans only, never key values). */
export const GET = route(async () => {
  const s = await requireStaff();
  return json({
    name: s.name, role: s.role, actor: staffActor(s),
    system: {
      db: dbKind(),
      providers: { anthropic: !!process.env.ANTHROPIC_API_KEY, vision: !!process.env.GOOGLE_VISION_API_KEY, sarvam: !!process.env.SARVAM_API_KEY },
      model: modelId(),
    },
  });
});
