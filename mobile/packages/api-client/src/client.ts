import type { Currency } from './currency';
import {
  ApiError,
  type AgentCustomer,
  type AgentOpInput,
  type AirtimeProduct,
  type CashoutRequest,
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
  type WithdrawalRequest,
} from './types';

export interface TicashApiOptions {
  baseUrl: string;
  /** Returns the current access token (or null), injected by the auth store. */
  getAccessToken?: () => string | null;
  /**
   * Called ONCE (single-flight) when an authenticated request gets a 401. Should
   * refresh the session and return true on success (access token now updated via
   * getAccessToken), false otherwise. On true the original request is replayed once.
   * Injected by the auth store; keeps the client framework-agnostic.
   */
  onUnauthorized?: () => Promise<boolean>;
  /** Send credentials (cookies) with requests — used by the web httpOnly-cookie session. */
  withCredentials?: boolean;
  /** Returns the readable double-submit CSRF token (web reads it from document.cookie),
   *  echoed in the x-ticash-csrf header so a cookie-based refresh passes the CSRF check. */
  getCsrfToken?: () => string | null;
  fetchImpl?: typeof fetch;
}

/** Typed client for the Ticash mobile API (the WS-0 `/app/*` endpoints). */
export class TicashApi {
  private readonly baseUrl: string;
  private readonly getAccessToken: () => string | null;
  private readonly onUnauthorized?: () => Promise<boolean>;
  private readonly withCredentials: boolean;
  private readonly getCsrfToken?: () => string | null;
  private readonly fetchImpl: typeof fetch;
  /** Shared in-flight refresh so N concurrent 401s trigger only ONE refresh. */
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(opts: TicashApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getAccessToken = opts.getAccessToken ?? (() => null);
    this.onUnauthorized = opts.onUnauthorized;
    this.withCredentials = opts.withCredentials ?? false;
    this.getCsrfToken = opts.getCsrfToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ---- auth (public) ----
  // Signup with profile + password; the OTP that follows verifies the phone.
  register(input: { phone: string; name?: string; country?: string; email?: string; password?: string }): Promise<{ user: PublicUser }> {
    return this.request('POST', '/app/auth/register', { body: input });
  }
  // Password login by email OR phone (no OTP).
  login(handle: string, password: string, device?: string): Promise<AuthTokens> {
    return this.request('POST', '/app/auth/login', { body: device ? { handle, password, device } : { handle, password } });
  }
  requestOtp(phone: string): Promise<{ sent: true }> {
    return this.request('POST', '/app/auth/otp', { body: { phone } });
  }
  verify(phone: string, code: string, device?: string): Promise<AuthTokens> {
    return this.request('POST', '/app/auth/verify', { body: device ? { phone, code, device } : { phone, code } });
  }
  // Forgot password: send an OTP to the account's phone (always succeeds).
  requestPasswordReset(handle: string): Promise<{ sent: true }> {
    return this.request('POST', '/app/auth/password/reset-request', { body: { handle } });
  }
  // Complete a reset: phone + OTP + new password -> logs in.
  resetPassword(phone: string, code: string, newPassword: string, device?: string): Promise<AuthTokens> {
    return this.request('POST', '/app/auth/password/reset', { body: device ? { phone, code, newPassword, device } : { phone, code, newPassword } });
  }
  // refreshToken is optional: the web cookie session provides it via the httpOnly
  // cookie (+ the x-ticash-csrf header); native passes the stored token in the body.
  refresh(refreshToken?: string): Promise<AuthTokens> {
    return this.request('POST', '/app/auth/refresh', { body: refreshToken ? { refreshToken } : {} });
  }
  logout(refreshToken?: string): Promise<{ ok: true }> {
    return this.request('POST', '/app/auth/logout', { body: refreshToken ? { refreshToken } : {} });
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
  /** Cash-out is now an APPROVAL request — returns a pending CashoutRequest. */
  agentCashOut(input: AgentOpInput): Promise<CashoutRequest> {
    return this.request('POST', '/app/agent/cash-out', { auth: true, body: input });
  }
  agentCashoutMine(): Promise<CashoutRequest[]> {
    return this.request('GET', '/app/cashout/mine', { auth: true });
  }
  // Customer: pending cash-out requests + approve (runs the debit) / reject.
  cashoutPending(): Promise<CashoutRequest[]> {
    return this.request('GET', '/app/cashout/pending', { auth: true });
  }
  cashoutApprove(id: string): Promise<CashoutRequest> {
    return this.request('POST', `/app/cashout/${id}/approve`, { auth: true, body: {} });
  }
  cashoutReject(id: string): Promise<CashoutRequest> {
    return this.request('POST', `/app/cashout/${id}/reject`, { auth: true, body: {} });
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
  p2pPay(id: string, input: { proofRef?: string; image?: string; contentType?: string }): Promise<P2POrder> {
    return this.request('POST', `/app/p2p/orders/${id}/pay`, { auth: true, body: input });
  }
  /** Fetch an order's payment-proof image (base64) — buyer or seller only. */
  p2pProofImage(id: string): Promise<{ image: string; contentType: string }> {
    return this.request('GET', `/app/p2p/orders/${id}/proof-image`, { auth: true });
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

  // USDT deposit (NOWPayments on-ramp): create a crypto payment; the returned
  // address is where the user sends USDT. Their wallet is credited on settlement.
  usdtDeposit(amount: string): Promise<{ paymentId: string; payAddress: string; payAmount: string; payCurrency: string; status: string }> {
    return this.request('POST', '/app/usdt/deposit', { auth: true, body: { amount } });
  }

  // USDT withdrawal (off-ramp / "Sacar USDT"): the request HOLDS the USDT (the
  // wallet is debited immediately); the operator sends it on-chain and completes
  // it, or it is rejected/cancelled and the USDT is refunded.
  usdtWithdrawFee(): Promise<{ feeMinor: string }> {
    return this.request('GET', '/app/usdt/withdraw/fee', { auth: true });
  }
  usdtWithdraw(input: { address: string; amount: string }): Promise<WithdrawalRequest> {
    return this.request('POST', '/app/usdt/withdraw', { auth: true, body: input });
  }
  usdtWithdrawals(): Promise<WithdrawalRequest[]> {
    return this.request('GET', '/app/usdt/withdrawals', { auth: true });
  }
  usdtWithdrawCancel(id: string): Promise<WithdrawalRequest> {
    return this.request('POST', `/app/usdt/withdrawals/${id}/cancel`, { auth: true, body: {} });
  }

  // PIX deposit (Lytex on-ramp): create a BRL charge; returns the PIX copy-and-paste
  // code + QR image to pay. The wallet is credited on settlement (Lytex webhook).
  depositPix(input: { amount: string; payerName: string; payerCpf: string }): Promise<{ providerId: string; status: string; amountMinor: string; pix: { copyPaste?: string; qrCodeImage?: string } }> {
    return this.request('POST', '/app/deposit/pix', { auth: true, body: input });
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

  /** Run the injected refresh, sharing one in-flight promise across concurrent 401s. */
  private runRefresh(): Promise<boolean> {
    if (!this.onUnauthorized) return Promise.resolve(false);
    if (!this.refreshInFlight) {
      this.refreshInFlight = Promise.resolve()
        .then(() => this.onUnauthorized!())
        .catch(() => false)
        .finally(() => { this.refreshInFlight = null; });
    }
    return this.refreshInFlight;
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean; retried?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.auth) {
      const token = this.getAccessToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    // Double-submit CSRF token for the cookie session (web). Harmless elsewhere.
    if (this.withCredentials) {
      const csrf = this.getCsrfToken?.();
      if (csrf) headers['x-ticash-csrf'] = csrf;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        ...(this.withCredentials ? { credentials: 'include' as RequestCredentials } : {}),
      });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', e instanceof Error ? e.message : 'network error');
    }
    // Silent refresh: a 401 on an authenticated request triggers ONE refresh (shared
    // across concurrent 401s); on success the original request is replayed exactly once.
    // The refresh call itself is unauthenticated, so it can't recurse here.
    if (res.status === 401 && opts.auth && !opts.retried && this.onUnauthorized) {
      const refreshed = await this.runRefresh();
      if (refreshed) return this.request<T>(method, path, { ...opts, retried: true });
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
