import { requireStaff } from '@/lib/auth';
import { openAlerts } from '@/lib/repo';
import { json, route } from '@/lib/http';

/** Open alerts across ALL encounters, independent of the encounter a staff member is viewing. */
export const GET = route(async () => {
  await requireStaff();
  return json({ alerts: await openAlerts() });
});
