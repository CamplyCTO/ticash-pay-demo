import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCurrency, CURRENCIES, Currency } from '../money/currency';
import { toMinor } from '../money/money';
import { customerWallet, agentFloat, agentCommission } from '../ledger/operations';
import { applyBps } from '../fx/rate-service';
import { RegistryError } from '../registry/store';
import type { ServerDeps } from './server';

const currencySchema = z.string().transform((v) => assertCurrency(v));
const amountSchema = z.union([z.string(), z.number()]);
const money = (amount: string | number, currency: Currency): bigint => toMinor(amount, currency);

/** The authenticated caller, attached by the /app/* JWT boundary (see server.ts). */
export interface AppUserContext {
  userId: string;
  role: 'customer' | 'agent';
  externalId: string;
}

export function appUserOf(req: FastifyRequest): AppUserContext {
  return (req as unknown as { appUser: AppUserContext }).appUser;
}

const phoneSchema = z.string().min(6).max(20);

/**
 * Mobile API for the customer + agent apps. Mounted under the `/app/*` prefix,
 * which is EXEMPT from the admin Basic Auth hook and instead JWT-authenticated.
 * Public auth endpoints live under `/app/auth/*`; everything else requires a
 * valid access token and is scoped to the caller's own `external_id`.
 */
export function registerAppRoutes(app: FastifyInstance, deps: ServerDeps): void {
  if (!deps.auth) return;
  const auth = deps.auth.service;

  // ---- public auth endpoints (no JWT) -------------------------------------
  app.post('/app/auth/register', async (req, reply) => {
    const b = z.object({ phone: phoneSchema, email: z.string().email().optional() }).parse(req.body);
    reply.status(201);
    return auth.registerCustomer({ phone: b.phone, ...(b.email ? { email: b.email } : {}) });
  });

  app.post('/app/auth/otp', async (req) => {
    const b = z.object({ phone: phoneSchema }).parse(req.body);
    return auth.requestOtp(b.phone);
  });

  app.post('/app/auth/verify', async (req) => {
    const b = z.object({ phone: phoneSchema, code: z.string().min(4).max(12), device: z.string().optional() }).parse(req.body);
    return auth.verifyOtp({ phone: b.phone, code: b.code, ...(b.device ? { device: b.device } : {}) });
  });

  app.post('/app/auth/refresh', async (req) => {
    const b = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
    return auth.refresh(b.refreshToken);
  });

  app.post('/app/auth/logout', async (req) => {
    const b = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
    return auth.logout(b.refreshToken);
  });

  // ---- protected: scoped strictly to the caller's own party ---------------
  // Profile + balances for the logged-in user. A customer sees only their own
  // wallet; an agent sees only their own float. Proof of per-user scoping.
  app.get('/app/me', async (req) => {
    const me = appUserOf(req);
    if (me.role === 'customer') {
      const customer = await deps.registry.getCustomer(me.externalId);
      const wallets = await balancesFor(deps, (ccy) => customerWallet(me.externalId, ccy));
      return { user: { id: me.userId, role: me.role, externalId: me.externalId }, kyc: customer ? { level: customer.kycLevel, status: customer.kycStatus } : null, wallets };
    }
    const agent = await deps.registry.getAgent(me.externalId);
    const float = await balancesFor(deps, (ccy) => agentFloat(me.externalId, ccy));
    const commission = await balancesFor(deps, (ccy) => agentCommission(me.externalId, ccy));
    return { user: { id: me.userId, role: me.role, externalId: me.externalId }, agent: agent ? { commissionBps: agent.commissionBps } : null, float, commission };
  });

  // A blocked customer can't transact (mirrors the admin routes).
  const requireCustomer = async (req: FastifyRequest): Promise<AppUserContext> => {
    const me = appUserOf(req);
    if (me.role !== 'customer') throw new RegistryError('this action is for customers', 'FORBIDDEN');
    const c = await deps.registry.getCustomer(me.externalId);
    if (c && c.status === 'blocked') throw new RegistryError('account is blocked', 'FORBIDDEN');
    return me;
  };

  // ---- FX: corridors + live quote (server-authoritative pricing) ----------
  if (deps.fx) {
    const fx = deps.fx.service;
    app.get('/app/fx/rates', async () => fx.list());
    // Rate only, or the FULL economics (recipient nets, fees, total to pay) when an amount is given.
    app.get('/app/fx/quote', async (req) => {
      const q = z.object({ from: currencySchema, to: currencySchema, amount: amountSchema.optional() }).parse(req.query);
      if (q.amount === undefined) return fx.quote(q.from, q.to);
      return fx.priceTransfer(q.from, q.to, money(q.amount, q.from));
    });
  }

  // ---- Send: cross-currency transfer, scoped to the caller as sender ------
  app.post('/app/transfers', async (req, reply) => {
    const me = await requireCustomer(req);
    const b = z
      .object({
        recipientRef: z.string().min(3),
        fromCurrency: currencySchema,
        toCurrency: currencySchema,
        sendAmount: amountSchema,
        idempotencyKey: z.string().min(1).optional(),
      })
      .parse(req.body);
    const sendMinor = money(b.sendAmount, b.fromCurrency);
    // AML on the recipient + KYC tier cap on the sender — same guards as the admin route.
    if (deps.screening) await deps.screening.service.assertClear(b.recipientRef, 'transfer');
    if (deps.kyc) await deps.kyc.limits.assertWithinLimit(me.externalId, sendMinor, b.fromCurrency);
    if (!deps.transfers) throw new RegistryError('transfers are not available', 'VALIDATION');
    reply.status(201);
    // senderId is the AUTHENTICATED caller — never taken from the body.
    return deps.transfers.service.initiate({
      senderId: me.externalId,
      recipientRef: b.recipientRef,
      fromCurrency: b.fromCurrency,
      toCurrency: b.toCurrency,
      sendMinor,
      idempotencyKey: b.idempotencyKey ?? `app-xfer:${me.externalId}:${randomUUID()}`,
    });
  });

  // ---- History: the caller's own transactions (across their wallets) ------
  app.get('/app/transactions', async (req) => {
    const me = appUserOf(req);
    const q = z.object({ limit: z.coerce.number().int().positive().max(200).optional() }).parse(req.query);
    const limit = q.limit ?? 50;
    const kind = me.role === 'customer' ? 'wallet' : 'agent_float';
    const perCurrency = await Promise.all(
      (Object.keys(CURRENCIES) as Currency[]).map((ccy) =>
        deps.ledger.getFeed({ accountKey: `${me.role}:${me.externalId}:${kind}:${ccy}`, limit }),
      ),
    );
    return perCurrency
      .flat()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  });

  // ---- KYC: limits (always) + start/sync the Sumsub flow (when configured) -
  if (deps.kyc) {
    const { limits, service } = deps.kyc;
    app.get('/app/kyc/limits', async () => limits.table());
    if (service) {
      app.post('/app/kyc/start', async (req) => {
        const me = await requireCustomer(req);
        return service.start(me.externalId);
      });
      app.post('/app/kyc/sync', async (req) => {
        const me = await requireCustomer(req);
        return service.sync(me.externalId);
      });
    }
  }

  // ---- Agent operations (cash-in / cash-out for a customer) ----------------
  // The agent is ALWAYS the authenticated caller; commission accrues to them.
  const requireAgent = async (req: FastifyRequest): Promise<AppUserContext> => {
    const me = appUserOf(req);
    if (me.role !== 'agent') throw new RegistryError('this action is for agents', 'FORBIDDEN');
    const a = await deps.registry.getAgent(me.externalId);
    if (a && a.status === 'blocked') throw new RegistryError('agent is blocked', 'FORBIDDEN');
    return me;
  };

  // Look up a customer to serve, by phone -> their external id + KYC.
  // POST (phone in the body) avoids the '+'-in-querystring decoding footgun.
  if (deps.auth) {
    app.post('/app/agent/customer', async (req) => {
      await requireAgent(req);
      const q = z.object({ phone: phoneSchema }).parse(req.body);
      const user = await deps.auth!.service.findUserByPhone(q.phone);
      if (!user || user.role !== 'customer') throw new RegistryError('no customer with that phone', 'NOT_FOUND');
      const customer = await deps.registry.getCustomer(user.externalId);
      return { externalId: user.externalId, phone: user.phone, kyc: customer ? { level: customer.kycLevel, status: customer.kycStatus } : null };
    });
  }

  const doAgentOp = async (req: FastifyRequest, reply: FastifyReply, kind: 'cash-in' | 'cash-out') => {
    const me = await requireAgent(req);
    const b = z
      .object({ customerId: z.string().min(1), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1).optional() })
      .parse(req.body);
    const customer = await deps.registry.getCustomer(b.customerId);
    if (!customer) throw new RegistryError(`customer ${b.customerId} not found`, 'NOT_FOUND');
    if (customer.status === 'blocked') throw new RegistryError('customer is blocked', 'FORBIDDEN');
    const agent = await deps.registry.getAgent(me.externalId);
    const amountMinor = money(b.amount, b.currency);
    // Cash-in increases the customer's spendable e-money, so it respects their KYC
    // tier cap (same control as a transfer). Cash-out spends their own balance — uncapped.
    if (kind === 'cash-in' && deps.kyc) await deps.kyc.limits.assertWithinLimit(b.customerId, amountMinor, b.currency);
    const commissionMinor = applyBps(amountMinor, agent?.commissionBps ?? 0);
    const idempotencyKey = b.idempotencyKey ?? `app-${kind}:${me.externalId}:${randomUUID()}`;
    reply.status(201);
    // agentId is the AUTHENTICATED caller — never taken from the body.
    const common = { agentId: me.externalId, customerId: b.customerId, currency: b.currency, amountMinor, commissionMinor, idempotencyKey };
    return kind === 'cash-in' ? deps.ledger.agentCashIn(common) : deps.ledger.agentCashOut(common);
  };
  app.post('/app/agent/cash-in', (req, reply) => doAgentOp(req, reply, 'cash-in'));
  app.post('/app/agent/cash-out', (req, reply) => doAgentOp(req, reply, 'cash-out'));

  // ---- Airtime top-up: any country, scoped to the caller's wallet ---------
  if (deps.airtime) {
    const air = deps.airtime.service;
    app.get('/app/airtime/products', async (req) => {
      const q = z.object({ country: z.string().length(2) }).parse(req.query);
      return air.products(q.country.toUpperCase());
    });
    app.post('/app/airtime/topup', async (req, reply) => {
      const me = await requireCustomer(req);
      const b = z
        .object({
          country: z.string().length(2),
          accountNumber: z.string().min(5),
          skuCode: z.string().min(1),
          cost: amountSchema,
          idempotencyKey: z.string().min(1).optional(),
        })
        .parse(req.body);
      reply.status(201);
      return air.topup({
        customerId: me.externalId,
        currency: 'BRL',
        countryIso: b.country.toUpperCase(),
        accountNumber: b.accountNumber,
        skuCode: b.skuCode,
        costMinor: money(b.cost, 'BRL'),
        idempotencyKey: b.idempotencyKey ?? `app-air:${me.externalId}:${randomUUID()}`,
      });
    });
  }
}

/** Non-zero balances across every supported currency for the given account-spec builder. */
async function balancesFor(
  deps: ServerDeps,
  spec: (ccy: Currency) => Parameters<ServerDeps['ledger']['getBalance']>[0],
): Promise<Array<{ currency: Currency; balanceMinor: string }>> {
  const out: Array<{ currency: Currency; balanceMinor: string }> = [];
  for (const ccy of Object.keys(CURRENCIES) as Currency[]) {
    const bal = await deps.ledger.getBalance(spec(ccy));
    if (bal !== 0n) out.push({ currency: ccy, balanceMinor: bal.toString() });
  }
  return out;
}
