import { encounterByToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { addEvent } from '@/lib/repo';
import { json, readJson, route } from '@/lib/http';

export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const enc = await encounterByToken((await ctx.params).token);
  const b = await readJson<{ language?: string; voice_consent?: boolean }>(req);
  const language = b.language === 'en' ? 'en' : 'hi';
  const voice = typeof b.voice_consent === 'boolean' ? b.voice_consent : null;
  const d = await db();
  await d.query('update encounters set language = $2, voice_consent = $3, intake_started_at = coalesce(intake_started_at, now()) where id = $1', [enc.id, language, voice]);
  await addEvent(d, { encounter_id: enc.id, actor: 'patient', role: 'patient', type: 'intake_started', payload: { language, voice_consent: voice } });
  return json({ ok: true });
});
