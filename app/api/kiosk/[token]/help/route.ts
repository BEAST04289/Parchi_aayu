import { encounterByToken } from '@/lib/auth';
import { raiseAlert } from '@/lib/repo';
import { json, route } from '@/lib/http';

/** Manual help request. Works without any AI. Idempotent: one open alert per encounter. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const enc = await encounterByToken((await ctx.params).token);
  const a = await raiseAlert(enc.id, 'manual', null, null);
  return json({ alert: { id: a.id, requested_at: a.requested_at, delivered: !!a.delivered_at, acked: !!a.acked_at, acked_by: a.acked_by } });
});
