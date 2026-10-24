/**
 * Database access. The only module that knows a connection string exists.
 *
 * Kept deliberately thin: the adapters build SQL and map rows, the domain never
 * sees either. `PSC_DATABASE_URL` absent is not an error — the test suite and
 * the domain tests must pass on a machine with no Postgres, so callers check
 * `isDatabaseConfigured()` and skip.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

let pool: Pool | undefined;

export function isDatabaseConfigured(): boolean {
  return (process.env['PSC_DATABASE_URL'] ?? '').trim().length > 0;
}

export function getPool(): Pool {
  const url = process.env['PSC_DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'PSC_DATABASE_URL is not set. The spatial layer needs PostgreSQL with PostGIS; see docs/phase-1b-findings.md for the local setup.',
    );
  }
  pool ??= new Pool({ connectionString: url, max: 4 });
  return pool;
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const rows = await query<T>(sql, params);
  const first = rows[0];
  if (first === undefined) {
    throw new Error('Expected exactly one row and got none.');
  }
  return first;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
