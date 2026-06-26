import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCurrency, Currency } from '../money/currency';
import { toMinor } from '../money/money';
import { AccountKind, AccountSpec, OwnerType } from '../ledger/types';
import { RegistryError } from '../registry/store';
import type { ServerDeps } from './server';

const currencySchema = z.string().transform((v) => assertCurrency(v));
const amountSchema = z.union([z.string(), z.number()]); // decimal major units, parsed exactly
const kycStatusSchema = z.enum(['pending', 'approved', 'rejected', 'review']);

function money(amount: string | number, currency: Currency): bigint {
  return toMinor(amount, currency);
}

export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { ledger, registry } = deps;

  // A blocked party is rejected by money operations (only if it's a known party;
  // unregistered ids are allowed, matching prior behaviour).
  const assertActiveCustomer = async (id: string) => {
    const c = await registry.getCustomer(id);
    if (c && c.status === 'blocked') throw new RegistryError(`customer ${id} is blocked`, 'FORBIDDEN');
  };
  const assertActiveAgent = async (id: string) => {
    const a = await registry.getAgent(id);
    if (a && a.status === 'blocked') throw new RegistryError(`agent ${id} is blocked`, 'FORBIDDEN');
  };

  // ---- party registry ------------------------------------------------------
  app.post('/customers', async (req, reply) => {
    const b = z.object({ externalId: z.string().min(1), kycLevel: z.number().int().min(0).max(2).optional(), kycStatus: kycStatusSchema.optional() }).parse(req.body);
    reply.status(201);
    return registry.createCustomer(b);
  });
  app.get('/customers', async () => registry.listCustomers());
  app.post('/customers/:externalId/kyc', async (req) => {
    const p = z.object({ externalId: z.string() }).parse(req.params);
    const b = z.object({ level: z.number().int().min(0).max(2), status: kycStatusSchema }).parse(req.body);
    return registry.setCustomerKyc(p.externalId, b.level, b.status);
  });

  app.post('/agents', async (req, reply) => {
    const b = z.object({ externalId: z.string().min(1), floatLimit: amountSchema.optional(), commissionBps: z.number().int().min(0).optional() }).parse(req.body);
    reply.status(201);
    return registry.createAgent({
      externalId: b.externalId,
      ...(b.floatLimit !== undefined ? { floatLimitMinor: money(b.floatLimit, 'BRL') } : {}),
      ...(b.commissionBps !== undefined ? { commissionBps: b.commissionBps } : {}),
    });
  });
  app.get('/agents', async () => registry.listAgents());

  // Block / re-activate parties (admin). A blocked agent/customer cannot transact.
  const statusBody = z.object({ status: z.enum(['active', 'blocked']) });
  app.post('/agents/:externalId/status', async (req) => {
    const p = z.object({ externalId: z.string() }).parse(req.params);
    const b = statusBody.parse(req.body);
    return registry.setAgentStatus(p.externalId, b.status);
  });
  app.post('/customers/:externalId/status', async (req) => {
    const p = z.object({ externalId: z.string() }).parse(req.params);
    const b = statusBody.parse(req.body);
    return registry.setCustomerStatus(p.externalId, b.status);
  });

  // ---- money operations ----------------------------------------------------
  app.post('/transactions/fund-wallet', async (req) => {
    const b = z.object({ customerId: z.string(), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1), externalRef: z.string().optional() }).parse(req.body);
    await assertActiveCustomer(b.customerId);
    return ledger.fundWallet({ customerId: b.customerId, currency: b.currency, amountMinor: money(b.amount, b.currency), idempotencyKey: b.idempotencyKey, ...(b.externalRef ? { externalRef: b.externalRef } : {}) });
  });

  app.post('/transactions/cash-in', async (req) => {
    const b = z.object({ agentId: z.string(), customerId: z.string(), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1) }).parse(req.body);
    await assertActiveAgent(b.agentId);
    await assertActiveCustomer(b.customerId);
    return ledger.cashIn({ agentId: b.agentId, customerId: b.customerId, currency: b.currency, amountMinor: money(b.amount, b.currency), idempotencyKey: b.idempotencyKey });
  });

  app.post('/transactions/cash-out', async (req) => {
    const b = z.object({ agentId: z.string(), customerId: z.string(), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1) }).parse(req.body);
    await assertActiveAgent(b.agentId);
    await assertActiveCustomer(b.customerId);
    return ledger.cashOut({ agentId: b.agentId, customerId: b.customerId, currency: b.currency, amountMinor: money(b.amount, b.currency), idempotencyKey: b.idempotencyKey });
  });

  app.post('/agents/float-topup', async (req) => {
    const b = z.object({ agentId: z.string(), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1), externalRef: z.string().optional() }).parse(req.body);
    await assertActiveAgent(b.agentId);
    return ledger.floatTopup({ agentId: b.agentId, currency: b.currency, amountMinor: money(b.amount, b.currency), idempotencyKey: b.idempotencyKey, ...(b.externalRef ? { externalRef: b.externalRef } : {}) });
  });

  app.post('/transactions/transfer', async (req) => {
    const b = z.object({ senderId: z.string(), recipientRef: z.string(), fromCurrency: currencySchema, toCurrency: currencySchema, sendAmount: amountSchema, feeAmount: amountSchema.optional(), rate: z.string().optional(), idempotencyKey: z.string().min(1) }).parse(req.body);
    await assertActiveCustomer(b.senderId);
    if (deps.screening) await deps.screening.service.assertClear(b.recipientRef, 'transfer');
    // `rate` and `feeAmount` are optional: when omitted, the corridor config supplies
    // the locked rate (FX margin) and the platform fee (WS-6/WS-7).
    const transferArgs = { senderId: b.senderId, recipientRef: b.recipientRef, fromCurrency: b.fromCurrency, toCurrency: b.toCurrency, sendMinor: money(b.sendAmount, b.fromCurrency), ...(b.feeAmount !== undefined ? { feeMinor: money(b.feeAmount, b.fromCurrency) } : {}), ...(b.rate ? { rate: b.rate } : {}), idempotencyKey: b.idempotencyKey };
    // Crash-safe saga (persists intent, resumable, creates the payout). Falls back to a
    // direct ledger transfer when no saga is wired (e.g. lightweight test servers).
    if (deps.transfers) {
      return deps.transfers.service.initiate(transferArgs);
    }
    if (!b.rate || b.feeAmount === undefined) throw new RegistryError('rate and fee are required (no FX service in this context)', 'VALIDATION');
    const result = await ledger.initiateTransfer({ senderId: b.senderId, recipientRef: b.recipientRef, fromCurrency: b.fromCurrency, toCurrency: b.toCurrency, sendMinor: money(b.sendAmount, b.fromCurrency), feeMinor: money(b.feeAmount, b.fromCurrency), rate: b.rate, idempotencyKey: b.idempotencyKey });
    if (deps.payouts) {
      await deps.payouts.service.createForTransfer({ correlationId: result.correlationId, recipientRef: b.recipientRef, quote: result.quote, senderId: b.senderId });
    }
    return result;
  });

  app.post('/transactions/settle-payout', async (req) => {
    const b = z.object({ currency: currencySchema, amount: amountSchema, correlationId: z.string(), externalRef: z.string(), idempotencyKey: z.string().min(1) }).parse(req.body);
    return ledger.settlePayout({ currency: b.currency, amountMinor: money(b.amount, b.currency), correlationId: b.correlationId, externalRef: b.externalRef, idempotencyKey: b.idempotencyKey });
  });

  // ---- reads ---------------------------------------------------------------
  app.get('/accounts/balance', async (req) => {
    const q = z.object({ ownerType: z.enum(['customer', 'agent', 'system']), ownerId: z.string().optional(), kind: z.string(), currency: currencySchema }).parse(req.query);
    const spec: AccountSpec = { ownerType: q.ownerType as OwnerType, ownerId: q.ownerId ?? null, kind: q.kind as AccountKind, currency: q.currency };
    return { accountKey: `${spec.ownerType}:${spec.ownerId ?? '_'}:${spec.kind}:${spec.currency}`, balanceMinor: await ledger.getBalance(spec) };
  });

  app.get('/ledger', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().positive().max(500).optional(), type: z.string().optional(), accountKey: z.string().optional() }).parse(req.query);
    return ledger.getFeed(q as never);
  });

  app.get('/balances', async () => ledger.listBalances());
  app.get('/reconciliation', async () => ledger.reconcile());

  // ---- FX rates (mid + margin -> locked customer rate) --------------------
  if (deps.fx) {
    const fx = deps.fx.service;
    // Rate only (no amount) or the FULL economics when an amount is given:
    // customer pays, gross payout, provider fee, net to recipient, platform net profit.
    app.get('/fx/quote', async (req) => {
      const q = z.object({ from: currencySchema, to: currencySchema, amount: amountSchema.optional() }).parse(req.query);
      if (q.amount === undefined) return fx.quote(q.from, q.to);
      return fx.priceTransfer(q.from, q.to, money(q.amount, q.from));
    });
    app.get('/fx/rates', async () => fx.list());
    // Admin: set/update a pair's mid rate + margin + platform fee + provider fee.
    app.post('/fx/rates', async (req, reply) => {
      const bps = z.number().int().min(0).max(9999);
      const b = z.object({ from: currencySchema, to: currencySchema, midRate: z.string().min(1), marginBps: bps, platformFeeBps: bps.optional(), providerFeeBps: bps.optional() }).parse(req.body);
      reply.status(201);
      return fx.setRate(b.from, b.to, b.midRate, b.marginBps, b.platformFeeBps ?? 0, b.providerFeeBps ?? 0);
    });
  }

  // ---- AML / sanctions screening ------------------------------------------
  if (deps.screening) {
    const scr = deps.screening.service;
    // Ad-hoc check (e.g. KYC onboarding) — returns the result; a hit is recorded.
    app.post('/screening/check', async (req) => {
      const b = z.object({ name: z.string().min(1) }).parse(req.body);
      return scr.screen(b.name, 'manual');
    });
    app.get('/screening/hits', async (req) => {
      const q = z.object({ limit: z.coerce.number().int().positive().max(500).optional() }).parse(req.query);
      return scr.hits(q.limit);
    });
  }

  // ---- mobile airtime recharge (DingConnect) ------------------------------
  if (deps.airtime) {
    const air = deps.airtime.service;
    app.get('/airtime/balance', async () => air.balance());
    app.get('/airtime/products', async (req) => {
      const q = z.object({ country: z.string().length(2) }).parse(req.query);
      return air.products(q.country.toUpperCase());
    });
    // Debit the customer wallet and send airtime; refunds the wallet if the send fails.
    app.post('/airtime/topup', async (req) => {
      const b = z.object({ customerId: z.string(), accountNumber: z.string().min(5), skuCode: z.string().min(1), sendAmount: amountSchema, idempotencyKey: z.string().min(1) }).parse(req.body);
      await assertActiveCustomer(b.customerId);
      return air.topup({ customerId: b.customerId, currency: 'BRL', accountNumber: b.accountNumber, skuCode: b.skuCode, amountMinor: money(b.sendAmount, 'BRL'), idempotencyKey: b.idempotencyKey });
    });
  }

  // ---- money-in (Lytex: PIX + card) ---------------------------------------
  // Registered only when a payment gateway is configured (LYTEX_CLIENT_ID set).
  if (deps.payments) {
    const { gateway, intents, events } = deps.payments;

    // Open a charge (PIX by default). On settlement, the webhook funds the wallet.
    app.post('/payments/charge', async (req, reply) => {
      const b = z
        .object({
          customerId: z.string().min(1),
          amount: amountSchema,
          methods: z.array(z.enum(['pix', 'creditCard', 'boleto'])).nonempty().optional(),
          payer: z.object({
            name: z.string().min(1),
            cpfCnpj: z.string().min(11),
            email: z.string().email().optional(),
            cellphone: z.string().optional(),
          }),
          reference: z.string().min(1).optional(),
          dueDate: z.string().optional(),
        })
        .parse(req.body);

      await assertActiveCustomer(b.customerId);
      if (deps.screening) await deps.screening.service.assertClear(b.payer.name, 'charge');
      const amountMinor = money(b.amount, 'BRL');
      const reference = b.reference ?? `chg-${b.customerId}-${amountMinor}`;
      const result = await gateway.createCharge({
        customerId: b.customerId,
        currency: 'BRL',
        amountMinor,
        methods: b.methods ?? ['pix'],
        payer: b.payer,
        reference,
        ...(b.dueDate ? { dueDate: b.dueDate } : {}),
      });
      await intents.create({
        providerId: result.providerId,
        provider: gateway.name,
        customerId: b.customerId,
        currency: 'BRL',
        amountMinor,
        reference,
      });
      reply.status(201);
      return { providerId: result.providerId, status: result.status, pix: result.pix };
    });

    app.get('/payments/intents', async () => intents.list());

    // Provider settlement callback. Authenticated by the provider's signature
    // (callback secret), NOT Basic Auth — see the onRequest hook in server.ts.
    app.post('/webhooks/lytex', async (req, reply) => {
      const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? '';
      const event = gateway.parseWebhook(rawBody, req.headers as Record<string, string | undefined>);
      if (!event) {
        reply.status(401);
        return { error: 'invalid signature' };
      }
      // Edge idempotency: a redelivered webhook is acknowledged without reprocessing.
      const eventUid = `${event.event}:${event.providerId}`;
      if (await events.seen(gateway.name, eventUid)) return { ok: true, duplicate: true };

      let result: Record<string, unknown>;
      if (!event.paid) {
        result = { ok: true, ignored: event.event };
      } else {
        const intent = await intents.get(event.providerId);
        if (!intent) {
          // Acknowledge so the provider stops retrying; nothing maps to this charge.
          req.log.warn({ providerId: event.providerId }, 'webhook for unknown charge');
          result = { ok: true, unmatched: event.providerId };
        } else {
          if (event.amountMinor != null && event.amountMinor !== intent.amountMinor) {
            req.log.warn(
              { providerId: event.providerId, reported: String(event.amountMinor), expected: String(intent.amountMinor) },
              'webhook amount mismatch; crediting recorded amount',
            );
          }
          // Credit the RECORDED amount, idempotent by provider charge id.
          const posted = await ledger.fundWallet({
            customerId: intent.customerId,
            currency: intent.currency,
            amountMinor: intent.amountMinor,
            idempotencyKey: `lytex:${event.providerId}`,
            externalRef: event.providerId,
          });
          await intents.markPaid(event.providerId);
          result = { ok: true, transactionUid: posted.transactionUid };
        }
      }
      // Record only after successful handling, so a failed handler is retried.
      await events.record(gateway.name, eventUid, event.event, event.raw);
      return result;
    });
  }

  // ---- money-out (MonCash payout state machine) ---------------------------
  if (deps.payouts) {
    const { service } = deps.payouts;

    app.get('/payouts', async () => service.list());

    // Send a created payout to the provider (created -> submitted).
    app.post('/payouts/:correlationId/submit', async (req) => {
      const p = z.object({ correlationId: z.string() }).parse(req.params);
      return service.submit(p.correlationId);
    });

    // Poll the provider and advance: success -> settled, failure -> reversed.
    app.post('/payouts/:correlationId/sync', async (req) => {
      const p = z.object({ correlationId: z.string() }).parse(req.params);
      return service.sync(p.correlationId);
    });

    // MANUAL release (operator paid out by hand) -> settles the ledger.
    app.post('/payouts/:correlationId/release', async (req) => {
      const p = z.object({ correlationId: z.string() }).parse(req.params);
      const b = z.object({ providerRef: z.string().optional() }).parse(req.body ?? {});
      return service.releaseManually(p.correlationId, b.providerRef);
    });

    // MANUAL fail (out-of-band payout failed) -> reverses, refunding the sender.
    app.post('/payouts/:correlationId/fail', async (req) => {
      const p = z.object({ correlationId: z.string() }).parse(req.params);
      return service.failManually(p.correlationId);
    });
  }
}
