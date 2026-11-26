import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

export async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(join(ROOT, 'tests/supabase-stub.sql'), 'utf8'));
  const dir = join(ROOT, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}

/** Creates an auth user (as Supabase Auth would on sign-up). */
export async function signUp(db: PGlite, email: string) {
  await db.exec('reset role');
  const { rows } = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
  return rows[0].id;
}

export class RpcError extends Error {
  constructor(public code: string, message: string, public fields: Record<string, string>) { super(message); }
}

/** Calls a function exactly like PostgREST does: as role "authenticated" with the user's id. */
export function client(db: PGlite, userId: string | null) {
  return async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const names = Object.keys(args);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
    const values = names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    await db.exec(`reset role; set request.jwt.claim.sub = '${userId ?? ''}'; set role ${userId ? 'authenticated' : 'anon'};`);
    try {
      const { rows } = await db.query<{ r: T }>(sql, values);
      return rows[0].r;
    } catch (e: any) {
      let fields = {};
      try { fields = JSON.parse(e.detail || '{}'); } catch { /* not json */ }
      throw new RpcError(e.code, e.message, fields);
    } finally {
      await db.exec('reset role');
    }
  };
}
