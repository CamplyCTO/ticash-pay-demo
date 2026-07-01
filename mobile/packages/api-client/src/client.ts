import type { Currency } from './currency';
import {
  ApiError,
  type AgentCustomer,
  type AgentOpInput,
  type AirtimeProduct,
  type ApiErrorCode,
  type AuthTokens,
  type CreateOfferInput,
  type KycLimit,
  type Me,
  type P2POffer,
  type P2POrder,
  type PublicUser,
  type RateQuote,
  type SendTransferInput,
  type TransferPricing,
  type TransferResult,
  type TxRow,
} from './types';

export interface TicashApiOptions {
  baseUrl: string;
  /** Returns the current access token (or null), injected by the auth store. */
  getAccessToken?: () => string | null;
  fetchImpl?: typeof fetch;
}

/** Typed client for the Ticash mobile API (the WS-0 `/app/*` endpoints). */
export class TicashApi {
  private readonly baseUrl: string;
  private readonly getAccessToken: () => string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TicashApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getAccessToken = opts.getAccessToken ?? (() => null);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ---- auth (public) ----
  register(phone: string, email?: string): Promise<{ user: PublicUser }> {
    return this.request('POST', '/app/auth/register', { body: email ? { phone, email } : { phone } });
  }
  requestOtp(phone: string): Promise<{ sent: true }> {
    return this.request('POST', '/app/auth/otp', { body: { phone } });
  }
  verify(phone: string, code: string, device?: string): Promise<AuthTokens> {
    return this.request('POST', '/app/auth/verify', { body: device ? { phone, code, device } : { phone, code } });
  }
  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.request('POST', '/app/auth/refresh', { body: { refreshToken } });
  }
  logout(refreshToken: string): Promise<{ ok: true }> {
    return this.request('POST', '/app/auth/logout', { body: { refreshToken } });
  }

  // ---- authenticated ----
  me(): Promise<Me> {
    return this.request('GET', '/app/me', { auth: true });
  }

  // FX: live rate, or full transfer economics when an amount is given.
  quote(from: Currency, to: Currency): Promise<RateQuote> {
    return this.request('GET', `/app/fx/quote?from=${from}&to=${to}`, { auth: true });
  }
  priceTransfer(from: Currency, to: Currency, amount: string): Promise<TransferPricing> {
    return this.request('GET', `/app/fx/quote?from=${from}&to=${to}&amount=${encodeURIComponent(amount)}`, { auth: true });
  }
  fxRates(): Promise<RateQuote[]> {
    return this.request('GET', '/app/fx/rates', { auth: true });
  }

  // Send: cross-currency transfer (sender = the authenticated caller).
  sendTransfer(input: SendTransferInput): Promise<TransferResult> {
    return this.request('POST', '/app/transfers', { auth: true, body: input });
  }

  // History: the caller's own transactions.
  transactions(limit = 50): Promise<TxRow[]> {
    return this.request('GET', `/app/transactions?limit=${limit}`, { auth: true });
  }

  // KYC
  kycLimits(): Promise<KycLimit[]> {
    return this.request('GET', '/app/kyc/limits', { auth: true });
  }
  kycStart(): Promise<{ token?: string; userId?: string; [k: string]: unknown }> {
    return this.request('POST', '/app/kyc/start', { auth: true, body: {} });
  }

  // Agent: look up a customer to serve, then cash-in / cash-out (agent = caller).
  lookupCustomer(phone: string): Promise<AgentCustomer> {
    return this.request('POST', '/app/agent/customer', { auth: true, body: { phone } });
  }
  agentCashIn(input: AgentOpInput): Promise<{ transactionUid?: string; [k: string]: unknown }> {
    return this.request('POST', '/app/agent/cash-in', { auth: true, body: input });
  }
  agentCashOut(input: AgentOpInput): Promise<{ transactionUid?: string; [k: string]: unknown }> {
    return this.request('POST', '/app/agent/cash-out', { auth: true, body: input });
  }

  // P2P USDT marketplace: browse/list offers, order, pay, release, dispute.
  p2pOffers(): Promise<P2POffer[]> {
    return this.request('GET', '/app/p2p/offers', { auth: true });
  }
  p2pMyOffers(): Promise<P2POffer[]> {
    return this.request('GET', '/app/p2p/offers/mine', { auth: true });
  }
  p2pCreateOffer(input: CreateOfferInput): Promise<P2POffer> {
    return this.request('POST', '/app/p2p/offers', { auth: true, body: input });
  }
  p2pCloseOffer(id: string): Promise<P2POffer> {
    return this.request('POST', `/app/p2p/offers/${id}/close`, { auth: true, body: {} });
  }
  p2pOpenOrder(input: { offerId: string; amount: string; methodType?: string }): Promise<P2POrder> {
    return this.request('POST', '/app/p2p/orders', { auth: true, body: input });
  }
  p2pMyOrders(role?: 'buyer' | 'seller'): Promise<P2POrder[]> {
    return this.request('GET', `/app/p2p/orders${role ? `?role=${role}` : ''}`, { auth: true });
  }
  p2pOrder(id: string): Promise<P2POrder> {
    return this.request('GET', `/app/p2p/orders/${id}`, { auth: true });
  }
  p2pPay(id: string, proofRef: string): Promise<P2POrder> {
    return this.request('POST', `/app/p2p/orders/${id}/pay`, { auth: true, body: { proofRef } });
  }
  p2pRelease(id: string): Promise<P2POrder> {
    return this.request('POST', `/app/p2p/orders/${id}/release`, { auth: true, body: {} });
  }
  p2pCancel(id: string): Promise<P2POrder> {
    return this.request('POST', `/app/p2p/orders/${id}/cancel`, { auth: true, body: {} });
  }
  p2pDispute(id: string, reason: string): Promise<P2POrder> {
    return this.request('POST', `/app/p2p/orders/${id}/dispute`, { auth: true, body: { reason } });
  }

  // Push notifications: register / opt-out this device.
  registerPush(expoToken: string, platform?: string): Promise<{ ok: true }> {
    return this.request('POST', '/app/push/register', { auth: true, body: platform ? { expoToken, platform } : { expoToken } });
  }
  unregisterPush(expoToken: string): Promise<{ ok: true }> {
    return this.request('POST', '/app/push/unregister', { auth: true, body: { expoToken } });
  }

  // Airtime
  airtimeProducts(country: string): Promise<AirtimeProduct[]> {
    return this.request('GET', `/app/airtime/products?country=${country}`, { auth: true });
  }
  airtimeTopup(input: { country: string; accountNumber: string; skuCode: string; cost: string; idempotencyKey?: string }): Promise<{ transactionUid?: string; [k: string]: unknown }> {
    return this.request('POST', '/app/airtime/topup', { auth: true, body: input });
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.auth) {
      const token = this.getAccessToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', e instanceof Error ? e.message : 'network error');
    }
    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      const code = normalizeCode((data as { code?: string }).code, res.status);
      const message = (data as { message?: string }).message ?? (data as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new ApiError(res.status, code, message);
    }
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function normalizeCode(code: string | undefined, status: number): ApiErrorCode {
  const known: ApiErrorCode[] = ['UNAUTHORIZED', 'INVALID_OTP', 'INVALID_REFRESH', 'RATE_LIMITED', 'CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'VALIDATION'];
  if (code && (known as string[]).includes(code)) return code as ApiErrorCode;
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  return 'UNKNOWN';
}
