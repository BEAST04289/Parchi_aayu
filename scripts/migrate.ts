/** Applies supabase/schema.sql to DATABASE_URL (Supabase). Idempotent. Run: npm run db:migrate */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL (Supabase connection string) first. Local PGlite applies the schema automatically.');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(fs.readFileSync(path.join(process.cwd(), 'supabase/schema.sql'), 'utf8'));
  const t = await c.query(`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1`);
  console.table(t.rows);
  await c.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
