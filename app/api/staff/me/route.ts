import { requireStaff, staffActor } from '@/lib/auth';
import { dbKind } from '@/lib/db';
import { publicProviderStatus } from '@/lib/pipeline/config';
import { mlHealth } from '@/lib/pipeline/ocr-paddle';
import { ollamaHealth } from '@/lib/pipeline/extract-lines';
import { json, route } from '@/lib/http';

/** Who is signed in, plus which providers are selected and reachable (names and booleans only, never key values). */
export const GET = route(async () => {
  const s = await requireStaff();
  const [ml, ollama] = await Promise.all([mlHealth(), ollamaHealth()]);
  return json({
    name: s.name, role: s.role, actor: staffActor(s),
    system: { db: dbKind(), providers: publicProviderStatus(), ml_ok: ml.ok, ollama_ok: ollama.ok && ollama.model_present },
  });
});
