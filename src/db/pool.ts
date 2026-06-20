import { Pool } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

/** Lazily-created shared connection pool. */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl, max: config.pgPoolMax });
    // An idle client emits 'error' if the DB restarts or the connection is severed.
    // Without a handler, Node treats it as an unhandled error and crashes the process,
    // so a routine DB failover/restart would take down the API. Log and let the pool
    // discard the dead client; the next query transparently opens a fresh connection.
    pool.on('error', (err) => {
      console.error('[pg pool] idle client error (recovering on next query):', err.message);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
