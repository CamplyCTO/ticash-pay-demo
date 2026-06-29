import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CURRENCIES, Currency } from '../money/currency';
import { customerWallet, agentFloat } from '../ledger/operations';
import type { ServerDeps } from './server';

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
    return { user: { id: me.userId, role: me.role, externalId: me.externalId }, agent: agent ? { commissionBps: agent.commissionBps } : null, float };
  });
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
