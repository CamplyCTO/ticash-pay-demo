import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCurrency, CURRENCIES, Currency } from '../money/currency';
import { toMinor } from '../money/money';
import { customerWallet, agentFloat, agentCommission } from '../ledger/operations';
import { applyBps } from '../fx/rate-service';
import { RegistryError } from '../registry/store';
import type { TransferRecord } from '../transfers/transfer-store';
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
  // Signup with profile + password. The OTP that follows VERIFIES the phone; after
  // that the user logs in with email/phone + password (no code every time).
  app.post('/app/auth/register', async (req, reply) => {
    const b = z
      .object({
        phone: phoneSchema,
        name: z.string().min(2).max(120).optional(),
        country: z.string().length(2).optional(),
        email: z.string().email().optional(),
        password: z.string().min(6).max(128).optional(),
      })
      .parse(req.body);
    reply.status(201);
    return auth.registerCustomer({
      phone: b.phone,
      ...(b.name ? { name: b.name } : {}),
      ...(b.country ? { country: b.country.toUpperCase() } : {}),
      ...(b.email ? { email: b.email } : {}),
      ...(b.password ? { password: b.password } : {}),
    });
  });

  // Password login (email or phone + password) — no OTP.
  app.post('/app/auth/login', async (req) => {
    const b = z.object({ handle: z.string().min(3), password: z.string().min(1), device: z.string().optional() }).parse(req.body);
    const tokens = await auth.loginWithPassword({ handle: b.handle, password: b.password, ...(b.device ? { device: b.device } : {}) });
    req.log.info({ audit: 'auth.login', userId: tokens.user.id, role: tokens.user.role, method: 'password' }, 'login');
    return tokens;
  });

  // Forgot password: send an OTP to the account's phone (always 200, no enumeration).
  app.post('/app/auth/password/reset-request', async (req) => {
    const b = z.object({ handle: z.string().min(3) }).parse(req.body);
    return auth.requestPasswordReset(b.handle);
  });

  // Complete a reset: phone + OTP + new password -> logs the user in.
  app.post('/app/auth/password/reset', async (req) => {
    const b = z.object({ phone: phoneSchema, code: z.string().min(4).max(12), newPassword: z.string().min(6).max(128), device: z.string().optional() }).parse(req.body);
    const tokens = await auth.resetPassword({ phone: b.phone, code: b.code, newPassword: b.newPassword, ...(b.device ? { device: b.device } : {}) });
    req.log.info({ audit: 'auth.reset', userId: tokens.user.id }, 'password reset');
    return tokens;
  });

  app.post('/app/auth/otp', async (req) => {
    const b = z.object({ phone: phoneSchema }).parse(req.body);
    return auth.requestOtp(b.phone);
  });

  app.post('/app/auth/verify', async (req) => {
    const b = z.object({ phone: phoneSchema, code: z.string().min(4).max(12), device: z.string().optional() }).parse(req.body);
    const tokens = await auth.verifyOtp({ phone: b.phone, code: b.code, ...(b.device ? { device: b.device } : {}) });
    req.log.info({ audit: 'auth.login', userId: tokens.user.id, role: tokens.user.role }, 'login');
    return tokens;
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
    const profile = await auth.profile(me.userId);
    const user = { id: me.userId, role: me.role, externalId: me.externalId, phone: profile?.phone ?? null, name: profile?.name ?? null, country: profile?.country ?? null, email: profile?.email ?? null };
    if (me.role === 'customer') {
      const customer = await deps.registry.getCustomer(me.externalId);
      const wallets = await balancesFor(deps, (ccy) => customerWallet(me.externalId, ccy));
      return { user, kyc: customer ? { level: customer.kycLevel, status: customer.kycStatus } : null, wallets };
    }
    const agent = await deps.registry.getAgent(me.externalId);
    const float = await balancesFor(deps, (ccy) => agentFloat(me.externalId, ccy));
    const commission = await balancesFor(deps, (ccy) => agentCommission(me.externalId, ccy));
    return { user, agent: agent ? { commissionBps: agent.commissionBps } : null, float, commission };
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
        recipientName: z.string().min(1).max(120).optional(),
        payoutRail: z.enum(['moncash', 'natcash']).optional(),
        fromCurrency: currencySchema,
        toCurrency: currencySchema,
        sendAmount: amountSchema,
        idempotencyKey: z.string().min(1).optional(),
      })
      .parse(req.body);
    const sendMinor = money(b.sendAmount, b.fromCurrency);
    // AML on the recipient (name + number) + KYC tier cap on the sender.
    if (deps.screening) {
      await deps.screening.service.assertClear(b.recipientRef, 'transfer');
      if (b.recipientName) await deps.screening.service.assertClear(b.recipientName, 'transfer');
    }
    if (deps.kyc) await deps.kyc.limits.assertWithinLimit(me.externalId, sendMinor, b.fromCurrency);
    if (!deps.transfers) throw new RegistryError('transfers are not available', 'VALIDATION');
    reply.status(201);
    // senderId is the AUTHENTICATED caller — never taken from the body.
    const result = await deps.transfers.service.initiate({
      senderId: me.externalId,
      recipientRef: b.recipientRef,
      recipientName: b.recipientName ?? null,
      payoutRail: b.payoutRail ?? null,
      fromCurrency: b.fromCurrency,
      toCurrency: b.toCurrency,
      sendMinor,
      idempotencyKey: b.idempotencyKey ?? `app-xfer:${me.externalId}:${randomUUID()}`,
    });
    req.log.info({ audit: 'money.transfer', senderId: me.externalId, from: b.fromCurrency, to: b.toCurrency, correlationId: result.correlationId }, 'transfer initiated');
    return result;
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
    const rows = perCurrency.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    // Enrich the caller's own send rows with recipient name/number/rail/status so the
    // activity list can show "sent to <name> (<number>) via MonCash · <status>".
    const byCorr = new Map<string, TransferRecord>();
    if (me.role === 'customer' && deps.transfers) {
      for (const t of await deps.transfers.service.history(me.externalId, 200)) byCorr.set(t.correlationId, t);
    }
    return rows.map((r) => {
      const t = r.correlationId ? byCorr.get(r.correlationId) : undefined;
      return t
        ? { ...r, recipientName: t.recipientName, recipientRef: t.recipientRef, payoutRail: t.payoutRail, transferStatus: t.status, receiveMinor: t.receiveMinor, toCurrency: t.toCurrency }
        : r;
    });
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
    const posted = kind === 'cash-in' ? await deps.ledger.agentCashIn(common) : await deps.ledger.agentCashOut(common);
    req.log.info({ audit: `money.${kind.replace('-', '_')}`, agentId: me.externalId, customerId: b.customerId, currency: b.currency }, `agent ${kind}`);
    // Money landed in the customer's wallet — alert them. Fire-and-forget: the push
    // must NEVER add latency to (or fail) the money operation.
    if (kind === 'cash-in' && deps.push) {
      void deps.push.service.notifyMoneyIn(b.customerId, b.currency, amountMinor).catch(() => { /* best-effort */ });
    }
    return posted;
  };
  app.post('/app/agent/cash-in', (req, reply) => doAgentOp(req, reply, 'cash-in'));

  // Cash-out is an APPROVAL request (security): the agent creates it, but NO money
  // moves until the customer approves it in-app. Knowing a number is not enough.
  if (deps.cashout) {
    const cashout = deps.cashout.service;
    app.post('/app/agent/cash-out', async (req, reply) => {
      const me = await requireAgent(req);
      const b = z.object({ customerId: z.string().min(1), currency: currencySchema, amount: amountSchema }).parse(req.body);
      const customer = await deps.registry.getCustomer(b.customerId);
      if (!customer) throw new RegistryError(`customer ${b.customerId} not found`, 'NOT_FOUND');
      if (customer.status === 'blocked') throw new RegistryError('customer is blocked', 'FORBIDDEN');
      const agent = await deps.registry.getAgent(me.externalId);
      const amountMinor = money(b.amount, b.currency);
      const commissionMinor = applyBps(amountMinor, agent?.commissionBps ?? 0);
      reply.status(201);
      const request = await cashout.request({ agentId: me.externalId, customerId: b.customerId, currency: b.currency, amountMinor, commissionMinor });
      req.log.info({ audit: 'cashout.request', agentId: me.externalId, customerId: b.customerId, currency: b.currency, requestId: request.id }, 'cash-out requested');
      // Ask the customer to approve (best-effort push — must never block the request).
      if (deps.push) void deps.push.service.notifyCashoutRequest(b.customerId, b.currency, amountMinor).catch(() => { /* best-effort */ });
      return request;
    });
    // Agent: their own cash-out requests + statuses; may cancel a pending one.
    app.get('/app/cashout/mine', async (req) => {
      const me = await requireAgent(req);
      return cashout.listByAgent(me.externalId, 50);
    });
    app.post('/app/cashout/:id/cancel', async (req) => {
      const me = await requireAgent(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      return cashout.cancel({ requestId: p.id, agentId: me.externalId });
    });
    // Customer: pending requests + approve (runs the debit) / reject (no debit).
    const requireCustomerRole = (req: FastifyRequest): AppUserContext => {
      const me = appUserOf(req);
      if (me.role !== 'customer') throw new RegistryError('this action is for customers', 'FORBIDDEN');
      return me;
    };
    app.get('/app/cashout/pending', async (req) => cashout.listPending(requireCustomerRole(req).externalId));
    app.post('/app/cashout/:id/approve', async (req) => {
      const me = requireCustomerRole(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      const r = await cashout.approve({ requestId: p.id, customerId: me.externalId });
      req.log.info({ audit: 'cashout.approve', customerId: me.externalId, requestId: p.id }, 'cash-out approved');
      return r;
    });
    app.post('/app/cashout/:id/reject', async (req) => {
      const me = requireCustomerRole(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      return cashout.reject({ requestId: p.id, customerId: me.externalId });
    });
  } else {
    app.post('/app/agent/cash-out', (req, reply) => doAgentOp(req, reply, 'cash-out'));
  }

  // ---- Push notifications: register / opt-out a device (scoped to caller) --
  if (deps.push) {
    const push = deps.push.service;
    app.post('/app/push/register', async (req, reply) => {
      const me = appUserOf(req);
      const b = z.object({ expoToken: z.string().min(1), platform: z.string().optional() }).parse(req.body);
      await push.register({ userId: me.userId, expoToken: b.expoToken, ...(b.platform ? { platform: b.platform } : {}) });
      reply.status(201);
      return { ok: true };
    });
    app.post('/app/push/unregister', async (req) => {
      const b = z.object({ expoToken: z.string().min(1) }).parse(req.body);
      await push.unregister(b.expoToken);
      return { ok: true };
    });
  }

  // ---- P2P USDT marketplace: sellers list, buyers order, seller confirms ---
  if (deps.p2p) {
    const p2p = deps.p2p.service;
    const methodSchema = z.object({ type: z.string().min(1).max(32), label: z.string().min(1).max(48), account: z.string().min(1).max(120) });

    // Browse active offers (any authenticated user). The merchant's account
    // NUMBER is withheld here (PII) and only revealed in the buyer's own order.
    const publicOffer = (o: Awaited<ReturnType<typeof p2p.listActiveOffers>>[number]) => ({
      ...o,
      methods: o.methods.map((m) => ({ type: m.type, label: m.label })),
    });
    app.get('/app/p2p/offers', async () => (await p2p.listActiveOffers()).map(publicOffer));
    // The caller's own offers (as a seller).
    app.get('/app/p2p/offers/mine', async (req) => {
      const me = await requireCustomer(req);
      return p2p.listMyOffers(me.externalId);
    });
    // List USDT for sale — locks the amount from the seller's USDT wallet into escrow.
    app.post('/app/p2p/offers', async (req, reply) => {
      const me = await requireCustomer(req);
      const b = z.object({
        fiatCurrency: currencySchema,
        pricePerUnit: z.string().min(1),
        amount: amountSchema, // USDT
        minAmount: amountSchema.optional(), // per-order fiat floor
        maxAmount: amountSchema.optional(), // per-order fiat cap
        payWindowMin: z.number().int().min(1).max(1440).optional(),
        methods: z.array(methodSchema).min(1).max(6),
      }).parse(req.body);
      reply.status(201);
      return p2p.createOffer({
        merchantId: me.externalId,
        fiatCurrency: b.fiatCurrency,
        pricePerUnit: b.pricePerUnit,
        totalMinor: money(b.amount, 'USDT'),
        minFiatMinor: b.minAmount !== undefined ? money(b.minAmount, b.fiatCurrency) : null,
        maxFiatMinor: b.maxAmount !== undefined ? money(b.maxAmount, b.fiatCurrency) : null,
        ...(b.payWindowMin !== undefined ? { payWindowMin: b.payWindowMin } : {}),
        methods: b.methods,
      });
    });
    app.post('/app/p2p/offers/:id/close', async (req) => {
      const me = await requireCustomer(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      return p2p.closeOffer({ offerId: p.id, merchantId: me.externalId });
    });

    // Buyer opens an order against an offer (reserves escrow; no money moves yet).
    app.post('/app/p2p/orders', async (req, reply) => {
      const me = await requireCustomer(req);
      const b = z.object({ offerId: z.string().min(1), amount: amountSchema, methodType: z.string().optional() }).parse(req.body);
      reply.status(201);
      const order = await p2p.openOrder({ offerId: b.offerId, buyerId: me.externalId, assetMinor: money(b.amount, 'USDT'), ...(b.methodType ? { methodType: b.methodType } : {}) });
      // Let the seller know they have a pending order to fulfil (best-effort).
      if (deps.push) void deps.push.service.notifyP2PNewOrder(order.merchantId, order.assetMinor).catch(() => { /* best-effort */ });
      return order;
    });
    // The caller's orders — as buyer by default, as seller with ?role=seller.
    app.get('/app/p2p/orders', async (req) => {
      const me = await requireCustomer(req);
      const q = z.object({ role: z.enum(['buyer', 'seller']).optional() }).parse(req.query);
      return q.role === 'seller' ? p2p.listOrdersForMerchant(me.externalId) : p2p.listMyOrders(me.externalId);
    });
    // Single order — visible only to its buyer or seller.
    app.get('/app/p2p/orders/:id', async (req) => {
      const me = await requireCustomer(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      const order = await p2p.getOrder(p.id);
      if (!order || (order.buyerId !== me.externalId && order.merchantId !== me.externalId)) throw new RegistryError('order not found', 'NOT_FOUND');
      return order;
    });
    // Buyer: report the off-platform payment sent (with a proof reference).
    app.post('/app/p2p/orders/:id/pay', async (req) => {
      const me = await requireCustomer(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      const b = z.object({ proofRef: z.string().min(1).max(2048) }).parse(req.body);
      const order = await p2p.submitPayment({ orderId: p.id, buyerId: me.externalId, proofRef: b.proofRef });
      // Nudge the seller to check the proof and release the USDT (best-effort).
      if (deps.push) void deps.push.service.notifyP2PPaymentSubmitted(order.merchantId, order.fiatCurrency, order.fiatMinor).catch(() => { /* best-effort */ });
      return order;
    });
    // Seller: confirm receipt → release escrowed USDT to the buyer (minus commission).
    app.post('/app/p2p/orders/:id/release', async (req) => {
      const me = await requireCustomer(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      const order = await p2p.releaseOrder({ orderId: p.id, merchantId: me.externalId });
      req.log.info({ audit: 'p2p.release', orderId: order.id, merchantId: me.externalId, buyerId: order.buyerId }, 'p2p release');
      if (deps.push) void deps.push.service.notifyMoneyIn(order.buyerId, order.asset, order.netToBuyerMinor).catch(() => { /* best-effort */ });
      return order;
    });
    // Buyer or seller cancels (buyer only before paying; seller may reject a claim).
    app.post('/app/p2p/orders/:id/cancel', async (req) => {
      const me = await requireCustomer(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      return p2p.cancelOrder({ orderId: p.id, byId: me.externalId, role: 'customer' });
    });
    // Buyer disputes (paid but not released) → escalates to the admin/central.
    app.post('/app/p2p/orders/:id/dispute', async (req) => {
      const me = await requireCustomer(req);
      const p = z.object({ id: z.string().min(1) }).parse(req.params);
      const b = z.object({ reason: z.string().min(1).max(500) }).parse(req.body);
      return p2p.disputeOrder({ orderId: p.id, buyerId: me.externalId, reason: b.reason });
    });
  }

  // ---- USDT deposit (NOWPayments on-ramp): fund your own USDT wallet -------
  if (deps.deposits) {
    const dep = deps.deposits;
    app.post('/app/usdt/deposit', async (req, reply) => {
      const me = await requireCustomer(req);
      const b = z.object({ amount: amountSchema }).parse(req.body); // USDT
      const amountMinor = money(b.amount, 'USDT');
      if (amountMinor <= 0n) throw new RegistryError('amount must be positive', 'VALIDATION');
      const orderId = `dep-${me.externalId}-${randomUUID()}`;
      const created = await dep.gateway.createDeposit({ amountMinor, orderId, callbackUrl: dep.callbackUrl });
      // Record the intent BEFORE returning: the wallet is funded on settlement by
      // looking this up, crediting the RECORDED amount (never the webhook's).
      await dep.intents.create({ providerId: created.paymentId, provider: dep.gateway.name, customerId: me.externalId, currency: 'USDT', amountMinor, reference: orderId });
      reply.status(201);
      return { paymentId: created.paymentId, payAddress: created.payAddress, payAmount: created.payAmount, payCurrency: created.payCurrency, status: created.status };
    });
  }

  // ---- PIX deposit (Lytex on-ramp): fund your own BRL wallet ---------------
  // Creates a PIX charge for the authenticated customer and records an intent;
  // the signed Lytex webhook (POST /webhooks/lytex) credits THIS wallet the
  // RECORDED amount on payment. Present only when a Lytex gateway is configured.
  if (deps.payments) {
    const pay = deps.payments;
    app.post('/app/deposit/pix', async (req, reply) => {
      const me = await requireCustomer(req);
      const b = z
        .object({
          amount: amountSchema,
          payerName: z.string().min(2),
          payerCpf: z.string().min(11).max(18),
        })
        .parse(req.body);
      const amountMinor = money(b.amount, 'BRL');
      if (amountMinor <= 0n) throw new RegistryError('amount must be positive', 'VALIDATION');
      // AML: screen the PIX payer against sanctions/PEP — parity with the admin
      // charge path; sanctioned funds must not enter the platform.
      if (deps.screening) await deps.screening.service.assertClear(b.payerName.trim(), 'deposit');
      const reference = `dep-pix-${me.externalId}-${randomUUID()}`;
      const charge = await pay.gateway.createCharge({
        customerId: me.externalId,
        currency: 'BRL',
        amountMinor,
        methods: ['pix'],
        payer: { name: b.payerName.trim(), cpfCnpj: b.payerCpf.replace(/\D/g, '') },
        reference,
      });
      await pay.intents.create({
        providerId: charge.providerId,
        provider: pay.gateway.name,
        customerId: me.externalId,
        currency: 'BRL',
        amountMinor,
        reference,
      });
      reply.status(201);
      return { providerId: charge.providerId, status: charge.status, amountMinor: amountMinor.toString(), pix: charge.pix ?? {} };
    });
  }

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
