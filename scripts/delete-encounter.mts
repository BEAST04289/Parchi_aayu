// Local admin: delete encounters (and everything that belongs to them) by id. Stop the server first on PGlite.
import { db } from '../lib/db';
const ids = process.argv.slice(2);
const d = await db();
for (const id of ids) {
  const [e] = await d.query<{ alias: string; patient_name: string }>('select alias, patient_name from encounters where id = $1', [id]);
  if (!e) { console.log('no encounter', id); continue; }
  for (const sql of [
    'delete from facts where encounter_id = $1', 'delete from questions where encounter_id = $1', 'delete from alerts where encounter_id = $1',
    'delete from events where encounter_id = $1', 'update sources set supersedes_id = null where encounter_id = $1', 'delete from sources where encounter_id = $1',
    'delete from blobs where encounter_id = $1', 'delete from encounters where id = $1',
  ]) await d.query(sql, [id]);
  console.log('deleted', e.alias, e.patient_name);
}
const left = await d.query<{ alias: string; patient_name: string }>('select alias, patient_name from encounters order by created_at');
console.log('remaining:', left.map((x) => `${x.alias} ${x.patient_name}`).join(' | '));
process.exit(0);
