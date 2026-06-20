import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCurrency, Currency } from '../money/currency';
import { toMinor } from '../money/money';
import { AccountKind, AccountSpec, OwnerType } from '../ledger/types';
import type { ServerDeps } from './server';

const currencySchema = z.string().transform((v) => assertCurrency(v));
const amountSchema = z.union([z.string(), z.number()]); // decimal major units, parsed exactly
const kycStatusSchema = z.enum(['pending', 'approved', 'rejected', 'review']);

function money(amount: string | number, currency: Currency): bigint {
  return toMinor(amount, currency);
}

export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { ledger, registry } = deps;

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

  // ---- money operations ----------------------------------------------------
  app.post('/transactions/fund-wallet', async (req) => {
    const b = z.object({ customerId: z.string(), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1), externalRef: z.string().optional() }).parse(req.body);
    return ledger.fundWallet({ customerId: b.customerId, currency: b.currency, amountMinor: money(b.amount, b.currency), idempotencyKey: b.idempotencyKey, ...(b.externalRef ? { externalRef: b.externalRef } : {}) });
  });

  app.post('/transactions/cash-in', async (req) => {
    const b = z.object({ agentId: z.string(), customerId: z.string(), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1) }).parse(req.body);
    return ledger.cashIn({ agentId: b.agentId, customerId: b.customerId, currency: b.currency, amountMinor: money(b.amount, b.currency), idempotencyKey: b.idempotencyKey });
  });

  app.post('/transactions/cash-out', async (req) => {
    const b = z.object({ agentId: z.string(), customerId: z.string(), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1) }).parse(req.body);
    return ledger.cashOut({ agentId: b.agentId, customerId: b.customerId, currency: b.currency, amountMinor: money(b.amount, b.currency), idempotencyKey: b.idempotencyKey });
  });

  app.post('/agents/float-topup', async (req) => {
    const b = z.object({ agentId: z.string(), currency: currencySchema, amount: amountSchema, idempotencyKey: z.string().min(1), externalRef: z.string().optional() }).parse(req.body);
    return ledger.floatTopup({ agentId: b.agentId, currency: b.currency, amountMinor: money(b.amount, b.currency), idempotencyKey: b.idempotencyKey, ...(b.externalRef ? { externalRef: b.externalRef } : {}) });
  });

  app.post('/transactions/transfer', async (req) => {
    const b = z.object({ senderId: z.string(), recipientRef: z.string(), fromCurrency: currencySchema, toCurrency: currencySchema, sendAmount: amountSchema, feeAmount: amountSchema, rate: z.string(), idempotencyKey: z.string().min(1) }).parse(req.body);
    return ledger.initiateTransfer({ senderId: b.senderId, recipientRef: b.recipientRef, fromCurrency: b.fromCurrency, toCurrency: b.toCurrency, sendMinor: money(b.sendAmount, b.fromCurrency), feeMinor: money(b.feeAmount, b.fromCurrency), rate: b.rate, idempotencyKey: b.idempotencyKey });
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
}
