/** Centralized, validated runtime configuration. */
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://ticash:ticash@localhost:5432/ticash',
  pgPoolMax: Number(process.env.PG_POOL_MAX ?? 10),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /** Use the in-memory store instead of Postgres (handy for local demos/tests). */
  useInMemory: process.env.STORE === 'memory',
  /** Seed demo data on boot (Jean → Marie story). For public demos. */
  seed: process.env.SEED === '1',
  /** Optional HTTP Basic auth over the whole API/panel (set both to enable). */
  basicAuthUser: process.env.BASIC_AUTH_USER ?? '',
  basicAuthPass: process.env.BASIC_AUTH_PASS ?? '',
} as const;
