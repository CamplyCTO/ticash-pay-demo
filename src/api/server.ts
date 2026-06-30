import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { config } from '../config';
import {
  createPaymentIntentStore,
  createPayoutStore,
  createProviderEventStore,
  createRateStore,
  createRegistry,
  createScreeningStore,
  createAirtimeMarginStore,
  createStore,
  createTransferStore,
  createAuthStore,
  createPushTokenStore,
} from '../ledger/store-factory';
import { RateService } from '../fx/rate-service';
import { seedDefaultRates } from '../fx/rate-store';
import { RateStore } from '../fx/types';
import { ScreeningService } from '../screening/screening-service';
import { DEFAULT_SANCTIONS } from '../screening/sanctions-list';
import { DingConnectAdapter } from '../airtime/dingconnect-adapter';
import { AirtimeService } from '../airtime/airtime-service';
import { SumsubAdapter } from '../kyc/sumsub-adapter';
import { KycService } from '../kyc/kyc-service';
import { KycLimits } from '../kyc/limits';
import { LedgerService } from '../ledger/service';
import { RegistryStore } from '../registry/store';
import { seedDemo } from '../demo/seed';
import { LytexPaymentAdapter } from '../payments/lytex-adapter';
import { PaymentIntentStore } from '../payments/intent-store';
import { ProviderEventStore } from '../payments/event-store';
import { PaymentInPort } from '../payments/types';
import { MonCashPayoutAdapter } from '../payouts/moncash-adapter';
import { NatcashPayoutAdapter } from '../payouts/natcash-adapter';
import { PayoutService } from '../payouts/payout-service';
import { ProviderFeeReconciliation } from '../payouts/reconciliation';
import { TransferService } from '../transfers/transfer-service';
import { AuthService } from '../auth/auth-service';
import { ConsoleOtpSender } from '../auth/otp-sender';
import { PushService } from '../push/push-service';
import { ExpoPushSender } from '../push/push-sender';
import { registerRoutes } from './routes';
import { registerAppRoutes } from './app-routes';
import { applySecurity, assertSecureConfig } from './security';

export interface ServerDeps {
  ledger: LedgerService;
  registry: RegistryStore;
  /** Money-in (Lytex) — present only when a gateway is configured. */
  payments?: { gateway: PaymentInPort; intents: PaymentIntentStore; events: ProviderEventStore };
  /** Money-out (MonCash) — present only when a payout rail is configured. */
  payouts?: { service: PayoutService };
  /** Crash-safe transfer saga. Always wired by defaultDeps; optional for tests. */
  transfers?: { service: TransferService };
  /** Provider-fee reconciliation (settled payouts vs ledger vs the rail's statement). */
  reconciliation?: { providerFees: ProviderFeeReconciliation };
  /** FX rate service (mid + margin -> locked customer rate). Always wired by defaultDeps. */
  fx?: { service: RateService; store: RateStore };
  /** AML/sanctions screening. Present when screening is enabled. */
  screening?: { service: ScreeningService };
  /** Mobile airtime recharge (DingConnect). Present when a key is configured. */
  airtime?: { service: AirtimeService };
  /** KYC: Sumsub verification (when configured) + per-level transaction limits (always on). */
  kyc?: { service?: KycService; limits: KycLimits };
  /** End-user auth for the mobile apps (phone+OTP -> JWT). Wired by defaultDeps. */
  auth?: { service: AuthService };
  /** Push notifications (device registry + dispatch). Wired when enabled. */
  push?: { service: PushService };
}

export function defaultDeps(): ServerDeps {
  const ledger = new LedgerService(createStore());
  const deps: ServerDeps = { ledger, registry: createRegistry() };
  if (config.lytex.enabled) {
    deps.payments = {
      gateway: new LytexPaymentAdapter(config.lytex),
      intents: createPaymentIntentStore(),
      events: createProviderEventStore(),
    };
  }
  // Payout state machine is always available; the provider is optional. Natcash
  // (BenCash) is the current Haiti rail; MonCash is the fallback once enabled.
  // Without any provider, payouts run in MANUAL mode (operator releases via panel).
  const payoutPort = config.natcash.enabled
    ? new NatcashPayoutAdapter(config.natcash)
    : config.moncash.enabled
      ? new MonCashPayoutAdapter(config.moncash)
      : undefined;
  const payoutStore = createPayoutStore();
  deps.payouts = { service: new PayoutService(payoutPort, payoutStore, ledger) };
  deps.reconciliation = { providerFees: new ProviderFeeReconciliation(payoutStore, ledger) };
  const rateStore = createRateStore();
  const rateService = new RateService(rateStore);
  deps.fx = { service: rateService, store: rateStore };
  deps.transfers = {
    service: new TransferService(ledger, createTransferStore(), deps.payouts.service, rateService),
  };
  if (config.screening.enabled) {
    deps.screening = { service: new ScreeningService(DEFAULT_SANCTIONS, createScreeningStore(), config.screening.threshold) };
  }
  if (config.dingconnect.enabled) {
    deps.airtime = { service: new AirtimeService(new DingConnectAdapter(config.dingconnect), ledger, createAirtimeMarginStore()) };
  }
  // KYC limits are always enforced; the Sumsub verification service is added when configured.
  const kycLimits = new KycLimits(deps.registry, config.kyc.limitByLevel);
  deps.kyc = config.sumsub.enabled
    ? { limits: kycLimits, service: new KycService(new SumsubAdapter(config.sumsub), deps.registry, config.sumsub.levelName) }
    : { limits: kycLimits };
  // End-user auth is always available; the OTP sender is pluggable (console for now,
  // a real SMS gateway once the client picks one — same port pattern as the providers).
  const authStore = createAuthStore();
  deps.auth = { service: new AuthService(authStore, deps.registry, new ConsoleOtpSender(), config.auth) };
  // Push: device registry + dispatch (shares the auth store to resolve party -> users).
  if (config.push.enabled) {
    const sender = new ExpoPushSender(config.push.expoAccessToken ? { accessToken: config.push.expoAccessToken } : {});
    deps.push = { service: new PushService(createPushTokenStore(), authStore, sender) };
  }
  return deps;
}

export function buildServer(deps: ServerDeps = defaultDeps()) {
  // Fail fast in production if the security-critical config is left at dev defaults.
  assertSecureConfig({
    requireSecureConfig: config.security.requireSecureConfig,
    jwtSecret: config.auth.jwtSecret,
    basicAuthUser: config.basicAuthUser,
    basicAuthPass: config.basicAuthPass,
    useInMemory: config.useInMemory,
  });
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: config.security.trustProxy, // real client IP behind Render's proxy
    bodyLimit: config.security.bodyLimitBytes,
  });

  // WS-6 hardening: per-IP rate limiting + security headers, registered FIRST so the
  // rate limiter runs before any auth work.
  applySecurity(app, config.security);

  // Optional HTTP Basic auth over everything except /health (so platform health
  // checks still pass). Enabled only when BASIC_AUTH_USER is set.
  if (config.basicAuthUser) {
    const expected = `Basic ${Buffer.from(`${config.basicAuthUser}:${config.basicAuthPass}`).toString('base64')}`;
    app.addHook('onRequest', async (req, reply) => {
      if (reply.sent) return; // an earlier hook (e.g. rate limit) already responded
      // /health for platform probes; /webhooks/* are authenticated by the
      // provider's own signature (callback secret); /app/* is the mobile API,
      // authenticated per-user by JWT (the boundary hook below) — none use Basic Auth.
      if (req.url === '/health' || req.url.startsWith('/webhooks/') || req.url.startsWith('/app/')) return;
      const provided = req.headers.authorization ?? '';
      if (!constantTimeEqual(provided, expected)) {
        reply
          .header('WWW-Authenticate', 'Basic realm="Ticash Pay"')
          .status(401)
          .send({ error: 'Unauthorized' });
      }
    });
  }

  // Mobile API auth boundary: every /app/* request except the public /app/auth/*
  // endpoints requires a valid JWT, and is scoped to the caller's own external_id.
  if (deps.auth) {
    const authService = deps.auth.service;
    app.addHook('onRequest', async (req, reply) => {
      if (reply.sent) return; // an earlier hook (e.g. rate limit) already responded
      if (!req.url.startsWith('/app/')) return; // only the mobile API
      if (req.url.startsWith('/app/auth/')) return; // public: register/otp/verify/refresh/logout
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const claims = token ? authService.verifyAccess(token) : null;
      if (!claims) {
        reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      (req as unknown as { appUser: unknown }).appUser = { userId: claims.sub, role: claims.role, externalId: claims.ext };
    });
  }

  // BigInt is not JSON-serializable by default; emit as string everywhere.
  // setReplySerializer applies to ALL routes (unlike setSerializerCompiler).
  app.setReplySerializer((payload) => JSON.stringify(payload, bigintReplacer));
  app.setErrorHandler((err, _req, reply) => {
    const code = (err as { code?: string }).code;
    const status =
      code === 'INSUFFICIENT_FUNDS' ? 409 :
      code === 'CONFLICT' ? 409 :
      code === 'NOT_FOUND' ? 404 :
      code === 'FORBIDDEN' ? 403 :
      code === 'LIMIT_EXCEEDED' ? 422 :
      code === 'UNBALANCED' ? 422 :
      code === 'UNAUTHORIZED' || code === 'INVALID_OTP' || code === 'INVALID_REFRESH' ? 401 :
      code === 'RATE_LIMITED' ? 429 :
      err.statusCode ?? 400;
    reply.status(status).send({ error: err.name ?? 'Error', code, message: err.message });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // Serve the admin panel (self-contained HTML). Read once at startup.
  const adminHtml = loadAdminHtml();
  app.get('/admin', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8').send(adminHtml);
  });

  // Keep the raw JSON body on the request (webhook signatures are computed over
  // the exact bytes). Behaviour is otherwise identical to Fastify's default parser.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  registerRoutes(app, deps);
  registerAppRoutes(app, deps);
  return app;
}

function loadAdminHtml(): string {
  // dist/api -> ../../public ; src/api (tsx) -> ../../public
  const candidates = [
    join(__dirname, '..', '..', 'public', 'admin.html'),
    join(process.cwd(), 'public', 'admin.html'),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  return '<!doctype html><h1>admin.html not found</h1>';
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

if (require.main === module) {
  const deps = defaultDeps();
  const app = buildServer(deps);
  (async () => {
    if (config.seed) {
      await seedDemo(deps);
      app.log.info('seeded demo data');
    }
    // Seed default FX rates if absent (Postgres; in-memory self-seeds).
    if (deps.fx) await seedDefaultRates(deps.fx.store, { marginBps: config.fx.defaultMarginBps, platformFeeBps: config.fx.defaultPlatformFeeBps, providerFeeBps: config.fx.defaultProviderFeeBps });
    // Recovery sweep: resume any transfer left half-finished by a previous crash.
    if (deps.transfers) {
      const resumed = await deps.transfers.service.recover();
      if (resumed > 0) app.log.warn(`recovered ${resumed} incomplete transfer(s)`);
    }
    const addr = await app.listen({ port: config.port, host: config.host });
    app.log.info(`Ticash Pay ledger API on ${addr} · admin at ${addr}/admin`);
  })().catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
