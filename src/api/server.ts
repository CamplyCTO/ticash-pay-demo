import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { config } from '../config';
import {
  createPaymentIntentStore,
  createPayoutStore,
  createProviderEventStore,
  createRegistry,
  createStore,
  createTransferStore,
} from '../ledger/store-factory';
import { LedgerService } from '../ledger/service';
import { RegistryStore } from '../registry/store';
import { seedDemo } from '../demo/seed';
import { LytexPaymentAdapter } from '../payments/lytex-adapter';
import { PaymentIntentStore } from '../payments/intent-store';
import { ProviderEventStore } from '../payments/event-store';
import { PaymentInPort } from '../payments/types';
import { MonCashPayoutAdapter } from '../payouts/moncash-adapter';
import { PayoutService } from '../payouts/payout-service';
import { TransferService } from '../transfers/transfer-service';
import { registerRoutes } from './routes';

export interface ServerDeps {
  ledger: LedgerService;
  registry: RegistryStore;
  /** Money-in (Lytex) — present only when a gateway is configured. */
  payments?: { gateway: PaymentInPort; intents: PaymentIntentStore; events: ProviderEventStore };
  /** Money-out (MonCash) — present only when a payout rail is configured. */
  payouts?: { service: PayoutService };
  /** Crash-safe transfer saga. Always wired by defaultDeps; optional for tests. */
  transfers?: { service: TransferService };
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
  // Payout state machine is always available; the provider is optional. Without a
  // provider (MonCash not yet enabled) payouts run in MANUAL mode — the operator
  // releases them by hand (Natcash/MonCash) via the panel.
  const payoutPort = config.moncash.enabled ? new MonCashPayoutAdapter(config.moncash) : undefined;
  deps.payouts = { service: new PayoutService(payoutPort, createPayoutStore(), ledger) };
  deps.transfers = {
    service: new TransferService(ledger, createTransferStore(), deps.payouts.service),
  };
  return deps;
}

export function buildServer(deps: ServerDeps = defaultDeps()) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  // Optional HTTP Basic auth over everything except /health (so platform health
  // checks still pass). Enabled only when BASIC_AUTH_USER is set.
  if (config.basicAuthUser) {
    const expected = `Basic ${Buffer.from(`${config.basicAuthUser}:${config.basicAuthPass}`).toString('base64')}`;
    app.addHook('onRequest', async (req, reply) => {
      // /health for platform probes; /webhooks/* are authenticated by the
      // provider's own signature (callback secret), not Basic Auth.
      if (req.url === '/health' || req.url.startsWith('/webhooks/')) return;
      const provided = req.headers.authorization ?? '';
      if (!constantTimeEqual(provided, expected)) {
        reply
          .header('WWW-Authenticate', 'Basic realm="Ticash Pay"')
          .status(401)
          .send({ error: 'Unauthorized' });
      }
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
      code === 'UNBALANCED' ? 422 :
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
