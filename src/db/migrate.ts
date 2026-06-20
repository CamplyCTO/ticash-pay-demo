import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closePool, getPool } from './pool';

/** Minimal forward-only migration runner. Applies db/migrations/*.sql in order. */
async function main(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const dir = join(__dirname, '..', '..', 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (done.rowCount) {
      console.log(`= skip ${file}`);
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    console.log(`+ apply ${file}`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
  }
  console.log('migrations complete');
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
