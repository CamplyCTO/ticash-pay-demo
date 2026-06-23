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
  /** Lytex money-in (PIX + card). Enabled only when a client id is present. */
  lytex: {
    enabled: !!process.env.LYTEX_CLIENT_ID,
    mode: process.env.LYTEX_MODE ?? 'sandbox',
    authBase: process.env.LYTEX_AUTH_BASE ?? 'https://sandbox-auth-pay.lytex.com.br',
    apiBase: process.env.LYTEX_API_BASE ?? 'https://sandbox-api-pay.lytex.com.br',
    clientId: process.env.LYTEX_CLIENT_ID ?? '',
    clientSecret: process.env.LYTEX_CLIENT_SECRET ?? '',
    callbackSecret: process.env.LYTEX_CALLBACK_SECRET ?? '',
    webhookMode: (process.env.LYTEX_WEBHOOK_MODE ?? 'hmac') as 'hmac' | 'secret',
  },
  /** MonCash payout (Haiti). Enabled only when a client id is present. */
  moncash: {
    enabled: !!process.env.MONCASH_CLIENT_ID,
    mode: process.env.MONCASH_MODE ?? 'sandbox',
    base: process.env.MONCASH_BASE ?? 'https://sandbox.moncashbutton.digicelgroup.com',
    clientId: process.env.MONCASH_CLIENT_ID ?? '',
    clientSecret: process.env.MONCASH_CLIENT_SECRET ?? '',
  },
} as const;
