import type { Currency } from './currency';

export type AppRole = 'customer' | 'agent';

export interface PublicUser {
  id: string;
  role: AppRole;
  externalId: string;
  phone: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export interface WalletBalance {
  currency: Currency;
  balanceMinor: string;
}

export interface MeCustomer {
  user: { id: string; role: 'customer'; externalId: string };
  kyc: { level: number; status: string } | null;
  wallets: WalletBalance[];
}

export interface MeAgent {
  user: { id: string; role: 'agent'; externalId: string };
  agent: { commissionBps: number } | null;
  float: WalletBalance[];
  commission: WalletBalance[];
}

export type Me = MeCustomer | MeAgent;

export function isCustomerMe(me: Me): me is MeCustomer {
  return me.user.role === 'customer';
}

// ---- WS-2 customer flows (BigInt fields arrive as strings over HTTP) ----

export interface RateQuote {
  fromCurrency: Currency;
  toCurrency: Currency;
  midRate: string;
  rate: string; // customer rate (mid - margin)
  marginBps: number;
  platformFeeBps: number;
  providerFeeBps: number;
  source: string;
  asOf: string;
}

export interface TransferPricing {
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: string;
  midRate: string;
  sendMinor: string;
  platformFeeMinor: string;
  totalDebitMinor: string; // what the customer pays (source ccy)
  grossPayoutMinor: string;
  providerFeeMinor: string;
  netToRecipientMinor: string; // what the recipient gets (dest ccy)
  fxMarginMinor: string;
  platformNetProfitMinor: string;
}

export interface TransferQuoteDTO {
  sendMinor: string;
  feeMinor: string;
  totalDebitMinor: string;
  rate: string;
  receiveMinor: string;
  fromCurrency: Currency;
  toCurrency: Currency;
}

export interface TransferResult {
  correlationId: string;
  quote: TransferQuoteDTO;
  status: 'pending' | 'debited' | 'fx_booked' | 'completed';
}

export interface TxRow {
  transactionUid: string;
  type: string;
  externalRef: string | null;
  correlationId: string | null;
  createdAt: string;
  accountKey: string;
  currency: Currency;
  amountMinor: string; // signed: + credit, - debit
}

export interface KycLimit {
  level: number;
  cap: number;
}

export interface AirtimeProduct {
  skuCode: string;
  description?: string;
  costMinor?: string;
  retailMinor?: string;
  currency?: string;
  [k: string]: unknown;
}

export interface SendTransferInput {
  recipientRef: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  sendAmount: string;
  idempotencyKey?: string;
}

// ---- WS-3 agent flows ----
export interface AgentCustomer {
  externalId: string;
  phone: string;
  kyc: { level: number; status: string } | null;
}

export interface AgentOpInput {
  customerId: string;
  currency: Currency;
  amount: string;
  idempotencyKey?: string;
}

// ---- WS-4 P2P USDT marketplace (BigInt fields arrive as strings) ----
export interface P2PPaymentMethod {
  type: string;
  label: string;
  account: string;
}

export type P2POfferStatus = 'active' | 'closed';
export type P2POrderStatus = 'created' | 'payment_submitted' | 'released' | 'cancelled' | 'disputed';

export interface P2POffer {
  id: string;
  merchantId: string;
  asset: Currency;
  fiatCurrency: Currency;
  pricePerUnit: string;
  totalMinor: string;
  remainingMinor: string;
  methods: P2PPaymentMethod[];
  status: P2POfferStatus;
  createdAt: string;
}

export interface P2POrder {
  id: string;
  offerId: string;
  merchantId: string;
  buyerId: string;
  asset: Currency;
  assetMinor: string;
  commissionMinor: string;
  netToBuyerMinor: string;
  fiatCurrency: Currency;
  fiatMinor: string;
  pricePerUnit: string;
  method: P2PPaymentMethod;
  status: P2POrderStatus;
  proofRef: string | null;
  disputeReason: string | null;
  timeoutAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOfferInput {
  fiatCurrency: Currency;
  pricePerUnit: string;
  amount: string; // USDT
  methods: P2PPaymentMethod[];
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_OTP'
  | 'INVALID_REFRESH'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NETWORK'
  | 'UNKNOWN';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
