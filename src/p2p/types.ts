import { Currency } from '../money/currency';

/**
 * P2P USDT marketplace domain (Phase 3 WS-4).
 *
 * A seller (merchant) lists USDT for sale; the listed amount is locked in the
 * ledger escrow. A buyer opens an order (reserving part of the offer), pays the
 * seller OFF-PLATFORM via a merchant-defined method (MonCash / Natcash / bank),
 * and uploads a proof. The seller checks their account and confirms receipt,
 * which releases the escrowed USDT to the buyer minus the platform commission.
 * Disputes and a confirm-timeout escalate to the admin (central) — never a blind
 * auto-release. Money moves only through the double-entry ledger (Σ=0 per ccy).
 */

export type OfferStatus = 'active' | 'closed';
export type OrderStatus = 'created' | 'payment_submitted' | 'released' | 'cancelled' | 'disputed';

/** Order states from which a reservation can still be returned to the offer. */
export const CANCELLABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['created', 'payment_submitted', 'disputed']);
/** Order states that still hold an escrow reservation (block closing the offer). */
export const ACTIVE_ORDER: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['created', 'payment_submitted', 'disputed']);

/** A seller's accepted payment method + receiving details (shown to the buyer). */
export interface PaymentMethod {
  type: string; // free-form, merchant-defined: 'moncash' | 'natcash' | 'bank' | 'pix' | ...
  label: string; // human label the buyer sees, e.g. "MonCash" / "Unibank"
  account: string; // the account / number / handle to pay to
}

export interface Offer {
  id: string;
  merchantId: string; // seller's party external_id
  asset: Currency; // the asset being sold (USDT)
  fiatCurrency: Currency; // what the buyer pays in (BRL / HTG / ...)
  pricePerUnit: string; // fiat per 1 whole unit of asset (decimal string)
  totalMinor: bigint; // asset originally listed
  remainingMinor: bigint; // asset still available (not reserved by open orders)
  minFiatMinor: bigint | null; // per-order minimum the buyer must pay (fiat); null = no floor
  maxFiatMinor: bigint | null; // per-order maximum the buyer may pay (fiat); null = no cap
  payWindowMin: number; // minutes the buyer has to pay after opening an order
  methods: PaymentMethod[];
  status: OfferStatus;
  createdAt: string;
}

export interface Order {
  id: string;
  offerId: string;
  merchantId: string;
  buyerId: string;
  asset: Currency;
  assetMinor: bigint; // gross USDT reserved from escrow
  commissionMinor: bigint; // platform cut, taken from the asset on release
  netToBuyerMinor: bigint; // assetMinor - commissionMinor (what the buyer receives)
  fiatCurrency: Currency;
  fiatMinor: bigint; // what the buyer pays off-platform
  pricePerUnit: string;
  method: PaymentMethod; // chosen method (copied from the offer for immutability)
  status: OrderStatus;
  proofRef: string | null; // buyer's payment proof (URL / reference — see note in service)
  disputeReason: string | null;
  timeoutAt: string | null; // when a submitted-but-unconfirmed order should escalate to admin
  createdAt: string;
  updatedAt: string;
}

export interface NewOffer {
  id: string;
  merchantId: string;
  asset: Currency;
  fiatCurrency: Currency;
  pricePerUnit: string;
  totalMinor: bigint;
  minFiatMinor: bigint | null;
  maxFiatMinor: bigint | null;
  payWindowMin: number;
  methods: PaymentMethod[];
}

export interface NewOrder {
  id: string;
  offerId: string;
  merchantId: string;
  buyerId: string;
  asset: Currency;
  assetMinor: bigint;
  commissionMinor: bigint;
  netToBuyerMinor: bigint;
  fiatCurrency: Currency;
  fiatMinor: bigint;
  pricePerUnit: string;
  method: PaymentMethod;
  timeoutAt: string | null;
}

export interface OrderPatch {
  status?: OrderStatus;
  proofRef?: string;
  disputeReason?: string;
  timeoutAt?: string | null;
}
