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
  },
  /** MonCash payout (Haiti). Enabled only when a client id is present. */
  moncash: {
    enabled: !!process.env.MONCASH_CLIENT_ID,
    mode: process.env.MONCASH_MODE ?? 'sandbox',
    base: process.env.MONCASH_BASE ?? 'https://sandbox.moncashbutton.digicelgroup.com',
    clientId: process.env.MONCASH_CLIENT_ID ?? '',
    clientSecret: process.env.MONCASH_CLIENT_SECRET ?? '',
  },
  /** Natcash payout via BenCash (Haiti). Enabled when a private key is present. */
  natcash: {
    enabled: !!process.env.NATCASH_PRIVATE_KEY,
    base: process.env.NATCASH_BASE ?? 'https://reseller.test.bencashgroup.com/api/channel',
    privateKey: process.env.NATCASH_PRIVATE_KEY ?? '',
  },
  /** FX defaults (basis points): platform FX margin, platform transfer fee, provider payout fee. */
  fx: {
    defaultMarginBps: Number(process.env.FX_MARGIN_BPS ?? 200),
    defaultPlatformFeeBps: Number(process.env.FX_PLATFORM_FEE_BPS ?? 0),
    defaultProviderFeeBps: Number(process.env.FX_PROVIDER_FEE_BPS ?? 500), // BenCash 5% (confirmed live: 200 HTG sent -> 190 received)
  },
  /** AML/sanctions screening. On by default; threshold is the 0..1 match cutoff. */
  screening: {
    enabled: (process.env.SCREENING ?? 'on') !== 'off',
    threshold: Number(process.env.SCREENING_THRESHOLD ?? 0.85),
  },
  /** DingConnect mobile-airtime recharge. Enabled when an API key is present. */
  dingconnect: {
    enabled: !!process.env.DINGCONNECT_API_KEY,
    base: process.env.DINGCONNECT_BASE ?? 'https://api.dingconnect.com/api/V1',
    apiKey: process.env.DINGCONNECT_API_KEY ?? '',
    // Default airtime margin (bps) applied to the provider cost (per-country override in DB).
    defaultMarginBps: Number(process.env.AIRTIME_MARGIN_BPS ?? 0),
  },
  /** Sumsub KYC. Enabled when an app token is present. */
  sumsub: {
    enabled: !!process.env.SUMSUB_APP_TOKEN,
    base: process.env.SUMSUB_BASE ?? 'https://api.sumsub.com',
    appToken: process.env.SUMSUB_APP_TOKEN ?? '',
    secretKey: process.env.SUMSUB_SECRET_KEY ?? '',
    levelName: process.env.SUMSUB_LEVEL ?? 'id-and-liveness',
  },
  /** KYC transaction limits: per-transaction BRL cap by KYC level (major units). */
  kyc: {
    limitByLevel: {
      0: Number(process.env.KYC_LIMIT_L0 ?? 500),
      1: Number(process.env.KYC_LIMIT_L1 ?? 5000),
      2: Number(process.env.KYC_LIMIT_L2 ?? 50000),
    } as Record<number, number>,
  },
  /** Security hardening (Phase 3 WS-6). */
  security: {
    /** HSTS: 'auto' = only when behind TLS (x-forwarded-proto=https); 'on'/'off' force it. */
    hsts: (process.env.SECURITY_HSTS ?? 'auto') as 'auto' | 'on' | 'off',
    /** Max request body (bytes). Default 256 KiB — guards against large-payload abuse. */
    bodyLimitBytes: Number(process.env.BODY_LIMIT_BYTES ?? 262144),
    /** Trust the platform proxy (Render) so req.ip is the real client for rate limiting. */
    trustProxy: (process.env.TRUST_PROXY ?? 'true') !== 'false',
    /** Refuse to boot with insecure defaults. Enable in prod (set SECURE_CONFIG=1). */
    requireSecureConfig: process.env.SECURE_CONFIG === '1',
    /**
     * Per-IP rate limits (fixed window) — a coarse DoS backstop, NOT the primary
     * brute-force control (that's the per-phone OTP limit, DB-backed). Defaults are
     * generous because mobile carrier-grade NAT puts many real users behind one IP;
     * tune per env. (At real scale, prefer a per-user limiter / Redis store.)
     */
    rateLimit: {
      auth: { max: Number(process.env.RL_AUTH_MAX ?? 60), windowMs: Number(process.env.RL_AUTH_WINDOW_MS ?? 60000) },
      global: { max: Number(process.env.RL_GLOBAL_MAX ?? 1200), windowMs: Number(process.env.RL_GLOBAL_WINDOW_MS ?? 60000) },
    },
  },
  /** NOWPayments USDT on-ramp (deposit). Enabled when an API key is present.
   *  Users create a crypto payment, send USDT to the address, and the signed IPN
   *  webhook credits their USDT wallet. Withdrawal (payout) is a later addition. */
  nowpayments: {
    enabled: !!process.env.NOWPAYMENTS_API_KEY,
    apiBase: process.env.NOWPAYMENTS_BASE ?? 'https://api.nowpayments.io/v1',
    apiKey: process.env.NOWPAYMENTS_API_KEY ?? '',
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET ?? '',
    payCurrency: process.env.NOWPAYMENTS_PAY_CURRENCY ?? 'usdttrc20', // USDT on Tron (low fee)
    // 'usd' is the universally-supported pricing combo. Peg drift is a non-issue
    // because settlement credits the EXACT USDT received (actually_paid from the
    // signed IPN), so the user is never short-changed regardless of the peg.
    priceCurrency: process.env.NOWPAYMENTS_PRICE_CURRENCY ?? 'usd',
    callbackUrl: process.env.NOWPAYMENTS_CALLBACK_URL ?? '', // public /webhooks/nowpayments
  },
  /** P2P USDT escrow marketplace (Phase 3 WS-4). Always on; the on/off-ramp
   *  (NOWPayments) that funds/withdraws USDT is wired separately once keyed. */
  p2p: {
    asset: 'USDT' as const,
    /** Platform commission on each trade (basis points; 200 = 2%). */
    commissionBps: Number(process.env.P2P_COMMISSION_BPS ?? 200),
    /** After the buyer submits payment, how long the seller has to confirm before
     *  the order can be escalated to the admin (central). Minutes. */
    confirmWindowMinutes: Number(process.env.P2P_CONFIRM_WINDOW_MIN ?? 30),
  },
  /** Cash-out approval: how long a pending cash-out request waits for the customer
   *  to approve before it auto-expires (no debit). Minutes. */
  cashout: {
    expiryMinutes: Number(process.env.CASHOUT_EXPIRY_MIN ?? 30),
  },
  /** Push notifications (Phase 3 WS-5). On by default; uses Expo's push API. */
  push: {
    enabled: (process.env.PUSH ?? 'on') !== 'off',
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? '', // optional (enhanced security)
  },
  /** SMS delivery for login OTP. Twilio enabled when an Account SID is present;
   *  otherwise the console sender logs the code (dev / pre-gateway). The client
   *  creates the Twilio account and sends the SID + Auth Token (same as the other
   *  providers); we set TWILIO_* env vars and real SMS turns on with no code change. */
  sms: {
    twilio: {
      enabled: !!process.env.TWILIO_ACCOUNT_SID,
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      from: process.env.TWILIO_FROM ?? '',
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? '',
      /** Twilio Verify (preferred): provider-managed OTP over WhatsApp + SMS with
       *  Brazil-compliant routing. Enabled when a Verify Service SID (VA…) is set;
       *  it then takes over from the raw-SMS sender. Channels are tried in order. */
      verify: {
        enabled: !!process.env.TWILIO_VERIFY_SERVICE_SID,
        serviceSid: process.env.TWILIO_VERIFY_SERVICE_SID ?? '',
        channels: (process.env.TWILIO_VERIFY_CHANNELS ?? 'sms')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    },
  },
  /** End-user auth for the mobile apps (Phase 3 WS-0). Always on; OTP sender is pluggable. */
  auth: {
    jwtSecret: process.env.AUTH_JWT_SECRET ?? 'dev-insecure-secret-change-me',
    accessTtlSec: Number(process.env.AUTH_ACCESS_TTL_SEC ?? 900), // 15 min
    refreshTtlSec: Number(process.env.AUTH_REFRESH_TTL_SEC ?? 60 * 60 * 24 * 30), // 30 days
    otpTtlSec: Number(process.env.AUTH_OTP_TTL_SEC ?? 300), // 5 min
    otpLength: Number(process.env.AUTH_OTP_LENGTH ?? 6),
    otpMaxPerHour: Number(process.env.AUTH_OTP_MAX_PER_HOUR ?? 5),
  },
} as const;
