// One-off: apply migrations to a REMOTE Postgres over SSL (Render external URL).
// The in-cluster app uses the internal URL (no SSL needed); this is just to
// verify the schema from a dev machine. Run: DATABASE_URL=... node scripts/migrate-remote.mjs
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, '..', 'db', 'migrations');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await pool.query(
  `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
);
for (const file of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  const done = await pool.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [file]);
  if (done.rowCount) {
    console.log(`= skip ${file}`);
    continue;
  }
  await pool.query(readFileSync(join(migDir, file), 'utf8'));
  await pool.query('INSERT INTO schema_migrations(filename) VALUES($1)', [file]);
  console.log(`+ apply ${file}`);
}
const t = await pool.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
);
console.log('tables:', t.rows.map((r) => r.table_name).join(', '));
const trg = await pool.query(
  "SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='postings' ORDER BY 1",
);
console.log('postings triggers:', trg.rows.map((r) => r.trigger_name).join(', '));
await pool.end();
console.log('OK migrations verified on remote DB');
