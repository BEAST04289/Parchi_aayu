import { encounterByToken } from '@/lib/auth';
import { json, route } from '@/lib/http';

/** Gap-driven follow-up questions are prompt B2 (eligibility from lib/questions/eligible.ts, owned by A2). */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  await encounterByToken((await ctx.params).token);
  return json({ error: 'Follow-up questions are not implemented yet (prompt B2).', done: true }, 501);
});
