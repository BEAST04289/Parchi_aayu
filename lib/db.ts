import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/**
 * One SQL interface over two backends:
 *  - Supabase Postgres via `pg` when DATABASE_URL is set (required on Vercel);
 *  - a local PGlite database in .data/pglite otherwise (local development only, labelled in the UI).
 * Both run the same supabase/schema.sql and the same queries.
 */

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Queryable {
  kind: 'supabase' | 'local';
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
}

/** Timestamps come back as ISO strings so API JSON matches lib/types.ts on both backends. */
function normalizeRow<T>(row: Record<string, unknown>): T {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v instanceof Date) row[k] = v.toISOString();
  }
  return row as T;
}

type PgPool = import('pg').Pool;
type PGliteT = import('@electric-sql/pglite').PGlite;

const g = globalThis as unknown as { __parchiDb?: Promise<Db> };

async function createSupabaseDb(url: string): Promise<Db> {
  const { Pool } = await import('pg');
  const pool: PgPool = new Pool({
    connectionString: url,
    max: 3,
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });
  const run = async <T>(c: { query: PgPool['query'] }, text: string, params?: unknown[]) => {
    // Unnamed statements only: works through Supabase's transaction pooler.
    const res = await c.query(text, params as unknown[]);
    return (res.rows as Record<string, unknown>[]).map((r) => normalizeRow<T>(r));
  };
  return {
    kind: 'supabase',
    query: (text, params) => run(pool, text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({ query: (text, params) => run(client, text, params) });
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

async function createLocalDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  // PGLITE_DIR lets a second local instance (e.g. the test gate) use its own database folder.
  const dir = process.env.PGLITE_DIR ? path.resolve(process.env.PGLITE_DIR) : path.join(process.cwd(), '.data', 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const pg: PGliteT = new PGlite(dir);
  await pg.waitReady;
  const schema = fs.readFileSync(path.join(process.cwd(), 'supabase', 'schema.sql'), 'utf8');
  await pg.exec(schema);
  return {
    kind: 'local',
    async query<T>(text: string, params?: unknown[]) {
      const res = await pg.query<Record<string, unknown>>(text, params as unknown[]);
      return res.rows.map((r) => normalizeRow<T>(r));
    },
    async tx(fn) {
      return pg.transaction(async (t) =>
        fn({
          async query<T>(text: string, params?: unknown[]) {
            const res = await t.query<Record<string, unknown>>(text, params as unknown[]);
            return res.rows.map((r) => normalizeRow<T>(r));
          },
        }),
      );
    },
  };
}

export function db(): Promise<Db> {
  if (!g.__parchiDb) {
    const url = process.env.DATABASE_URL;
    if (url) {
      g.__parchiDb = createSupabaseDb(url);
    } else if (process.env.VERCEL) {
      // Never fall back to a local file database on Vercel.
      throw new Error('DATABASE_URL is not configured on this deployment.');
    } else {
      g.__parchiDb = createLocalDb();
    }
    g.__parchiDb.catch(() => {
      g.__parchiDb = undefined;
    });
  }
  return g.__parchiDb;
}

export function dbKind(): 'supabase' | 'local' {
  return process.env.DATABASE_URL ? 'supabase' : 'local';
}

/** Postgres unique-violation code, for compare-and-swap conflicts. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
