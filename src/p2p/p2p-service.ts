import { randomUUID } from 'node:crypto';
import { Currency } from '../money/currency';
import { convert } from '../money/money';
import { applyBps } from '../fx/rate-service';
import { LedgerService } from '../ledger/service';
import { SettingsStore } from '../settings/settings-store';
import { P2PError, P2PStore } from './p2p-store';
import { Offer, Order, PaymentMethod } from './types';

const COMMISSION_KEY = 'p2p_commission_bps';

export interface P2PConfig {
  asset: Currency; // 'USDT'
  commissionBps: number;
  confirmWindowMinutes: number;
}

/** Default minutes a buyer has to pay after opening an order (when the seller
 *  doesn't set one on the offer). Independent of the seller-confirm window. */
const DEFAULT_PAY_WINDOW_MIN = 15;

/**
 * Orchestrates the P2P USDT marketplace over the ledger (escrow) + the P2P store
 * (offers/orders). Every money movement is a balanced ledger journal; the store
 * only holds marketplace state. All ledger calls are idempotent by a key derived
 * from the offer/order id, so a retried release can never double-move funds.
 *
 * NOTE (MVP): payment `proof` is stored as a reference string (URL/text). Binary
 * image storage (S3/bytea) is a deliberate follow-up — it doesn't change the
 * escrow state machine, which is the part that must be correct.
 */
export class P2PService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly store: P2PStore,
    private readonly cfg: P2PConfig,
    private readonly settings?: SettingsStore,
  ) {}

  /** The current P2P commission (bps). Admin-editable via the settings store;
   *  falls back to the configured default. */
  async getCommissionBps(): Promise<number> {
    if (!this.settings) return this.cfg.commissionBps;
    const v = await this.settings.get(COMMISSION_KEY);
    const n = v === null ? NaN : Number(v);
    return Number.isInteger(n) && n >= 0 ? n : this.cfg.commissionBps;
  }

  /** Admin sets the P2P commission (persisted). Applies to NEW orders. */
  async setCommissionBps(bps: number): Promise<number> {
    if (!Number.isInteger(bps) || bps < 0 || bps > 2000) throw new P2PError('commission must be 0..2000 bps (0..20%)', 'VALIDATION');
    if (this.settings) await this.settings.set(COMMISSION_KEY, String(bps));
    else this.cfg.commissionBps = bps;
    return bps;
  }

  // ---- seller: list / close ------------------------------------------------

  /** List USDT for sale: locks `totalMinor` from the seller's wallet into escrow. */
  async createOffer(args: {
    merchantId: string;
    fiatCurrency: Currency;
    pricePerUnit: string;
    totalMinor: bigint;
    minFiatMinor?: bigint | null;
    maxFiatMinor?: bigint | null;
    payWindowMin?: number;
    methods: PaymentMethod[];
  }): Promise<Offer> {
    if (args.totalMinor <= 0n) throw new P2PError('amount must be positive', 'VALIDATION');
    if (!args.methods.length) throw new P2PError('at least one payment method is required', 'VALIDATION');
    for (const m of args.methods) {
      if (!m.type?.trim() || !m.label?.trim() || !m.account?.trim()) throw new P2PError('each payment method needs type, label and account', 'VALIDATION');
    }
    assertRate(args.pricePerUnit);
    if (args.fiatCurrency === this.cfg.asset) throw new P2PError('fiat currency must differ from the asset', 'VALIDATION');

    // Optional per-order fiat limits + the buyer's payment window.
    const minFiatMinor = args.minFiatMinor ?? null;
    const maxFiatMinor = args.maxFiatMinor ?? null;
    if (minFiatMinor !== null && minFiatMinor < 0n) throw new P2PError('minimum cannot be negative', 'VALIDATION');
    if (maxFiatMinor !== null && maxFiatMinor <= 0n) throw new P2PError('maximum must be positive', 'VALIDATION');
    if (minFiatMinor !== null && maxFiatMinor !== null && minFiatMinor > maxFiatMinor) throw new P2PError('minimum cannot exceed maximum', 'VALIDATION');
    // The max a buyer can pay can never exceed the offer's total value — a seller can
    // only sell the USDT they actually hold (else they couldn't deliver). Cap it.
    const offerValueFiat = convert(args.totalMinor, this.cfg.asset, args.fiatCurrency, args.pricePerUnit);
    if (maxFiatMinor !== null && maxFiatMinor > offerValueFiat) throw new P2PError('maximum exceeds the offer value — you can only sell the USDT you hold', 'VALIDATION');
    const payWindowMin = args.payWindowMin ?? DEFAULT_PAY_WINDOW_MIN;
    if (!Number.isInteger(payWindowMin) || payWindowMin < 1 || payWindowMin > 1440) throw new P2PError('payment window must be 1..1440 minutes', 'VALIDATION');

    const id = randomUUID();
    // Lock first: this validates the seller actually holds the USDT (the wallet
    // is non-negative). Only then does the offer become visible to buyers.
    await this.ledger.p2pLock({ merchantId: args.merchantId, currency: this.cfg.asset, amountMinor: args.totalMinor, idempotencyKey: `p2p:lock:${id}`, correlationId: id });
    try {
      return await this.store.createOffer({
        id,
        merchantId: args.merchantId,
        asset: this.cfg.asset,
        fiatCurrency: args.fiatCurrency,
        pricePerUnit: args.pricePerUnit,
        totalMinor: args.totalMinor,
        minFiatMinor,
        maxFiatMinor,
        payWindowMin,
        methods: args.methods,
      });
    } catch (err) {
      // Compensate a failed insert so the seller's locked funds aren't stranded.
      await this.ledger.p2pUnlock({ merchantId: args.merchantId, currency: this.cfg.asset, amountMinor: args.totalMinor, idempotencyKey: `p2p:unlock:${id}` }).catch(() => {});
      throw err;
    }
  }

  /** Close an offer and return its un-sold remainder to the seller's wallet. */
  async closeOffer(args: { offerId: string; merchantId: string }): Promise<Offer> {
    const offer = await this.store.getOffer(args.offerId);
    if (!offer) throw new P2PError('offer not found', 'NOT_FOUND');
    if (offer.merchantId !== args.merchantId) throw new P2PError('not your offer', 'FORBIDDEN');
    if (offer.status !== 'active') throw new P2PError('offer is not active', 'CONFLICT');
    if (await this.store.hasActiveOrders(args.offerId)) throw new P2PError('resolve pending orders before closing', 'CONFLICT');
    // Flip status first (no new orders can reserve), then return the remainder.
    const closed = await this.store.closeOffer(args.offerId, args.merchantId);
    if (!closed) throw new P2PError('offer is not active', 'CONFLICT');
    if (closed.remainingMinor > 0n) {
      await this.ledger.p2pUnlock({ merchantId: args.merchantId, currency: this.cfg.asset, amountMinor: closed.remainingMinor, idempotencyKey: `p2p:unlock:${args.offerId}` });
    }
    return closed;
  }

  listActiveOffers(): Promise<Offer[]> {
    return this.store.listActiveOffers();
  }
  listMyOffers(merchantId: string): Promise<Offer[]> {
    return this.store.listOffersByMerchant(merchantId);
  }

  // ---- buyer: open order / pay / dispute -----------------------------------

  /** Open a buy order against an offer, reserving `assetMinor` of its escrow. */
  async openOrder(args: { offerId: string; buyerId: string; assetMinor: bigint; methodType?: string }): Promise<Order> {
    const offer = await this.store.getOffer(args.offerId);
    if (!offer) throw new P2PError('offer not found', 'NOT_FOUND');
    if (offer.status !== 'active') throw new P2PError('offer is not active', 'CONFLICT');
    if (offer.merchantId === args.buyerId) throw new P2PError('you cannot buy your own offer', 'VALIDATION');
    if (args.assetMinor <= 0n) throw new P2PError('amount must be positive', 'VALIDATION');

    const method = args.methodType ? offer.methods.find((m) => m.type === args.methodType) : offer.methods[0];
    if (!method) throw new P2PError('payment method not offered', 'VALIDATION');

    const commissionMinor = applyBps(args.assetMinor, await this.getCommissionBps());
    const netToBuyerMinor = args.assetMinor - commissionMinor;
    const fiatMinor = convert(args.assetMinor, offer.asset, offer.fiatCurrency, offer.pricePerUnit);

    // Enforce the seller's per-order fiat limits.
    if (offer.minFiatMinor !== null && fiatMinor < offer.minFiatMinor) throw new P2PError('below the offer minimum', 'VALIDATION');
    if (offer.maxFiatMinor !== null && fiatMinor > offer.maxFiatMinor) throw new P2PError('above the offer maximum', 'VALIDATION');

    // Buyer must pay within the offer's payment window (advisory deadline surfaced
    // to the buyer + admin; escrow stays reserved until pay/cancel/expiry).
    const timeoutAt = new Date(Date.now() + offer.payWindowMin * 60_000).toISOString();

    return this.store.createOrder({
      id: randomUUID(),
      offerId: offer.id,
      merchantId: offer.merchantId,
      buyerId: args.buyerId,
      asset: offer.asset,
      assetMinor: args.assetMinor,
      commissionMinor,
      netToBuyerMinor,
      fiatCurrency: offer.fiatCurrency,
      fiatMinor,
      pricePerUnit: offer.pricePerUnit,
      method,
      timeoutAt,
    });
  }

  /** Buyer marks the off-platform payment as sent, attaching a proof reference. */
  async submitPayment(args: { orderId: string; buyerId: string; proofRef: string }): Promise<Order> {
    const order = await this.requireOrder(args.orderId);
    if (order.buyerId !== args.buyerId) throw new P2PError('not your order', 'FORBIDDEN');
    const timeoutAt = new Date(Date.now() + this.cfg.confirmWindowMinutes * 60_000).toISOString();
    const updated = await this.store.casUpdate(order.id, ['created'], { status: 'payment_submitted', proofRef: args.proofRef, timeoutAt });
    if (!updated) throw new P2PError(`order is ${order.status}, cannot submit payment`, 'CONFLICT');
    return updated;
  }

  /** Buyer disputes an unconfirmed order (paid but not released) → goes to admin. */
  async disputeOrder(args: { orderId: string; buyerId: string; reason: string }): Promise<Order> {
    const order = await this.requireOrder(args.orderId);
    if (order.buyerId !== args.buyerId) throw new P2PError('not your order', 'FORBIDDEN');
    const updated = await this.store.casUpdate(order.id, ['payment_submitted'], { status: 'disputed', disputeReason: args.reason });
    if (!updated) throw new P2PError(`order is ${order.status}, cannot dispute`, 'CONFLICT');
    return updated;
  }

  // ---- seller: confirm / reject --------------------------------------------

  /** Seller confirms receipt → releases escrow to the buyer minus commission. */
  async releaseOrder(args: { orderId: string; merchantId: string }): Promise<Order> {
    const order = await this.requireOrder(args.orderId);
    if (order.merchantId !== args.merchantId) throw new P2PError('not your order', 'FORBIDDEN');
    return this.doRelease(order, ['payment_submitted']);
  }

  /** Seller or buyer cancels. Buyer only before paying; seller may reject a claimed payment. */
  async cancelOrder(args: { orderId: string; byId: string; role: 'customer' }): Promise<Order> {
    const order = await this.requireOrder(args.orderId);
    const isBuyer = order.buyerId === args.byId;
    const isMerchant = order.merchantId === args.byId;
    if (!isBuyer && !isMerchant) throw new P2PError('not your order', 'FORBIDDEN');
    if (isBuyer && !isMerchant && order.status !== 'created') {
      throw new P2PError('you already reported payment; open a dispute instead of cancelling', 'CONFLICT');
    }
    return this.store.cancelOrder(order.id); // atomically restores the reservation
  }

  // ---- admin (central): resolve disputes / stuck orders --------------------

  listOrdersByStatus(status: Order['status']): Promise<Order[]> {
    return this.store.listOrdersByStatus(status);
  }
  /** Every order (all statuses), newest first — admin settlement oversight. */
  listAllOrders(): Promise<Order[]> {
    return this.store.listAllOrders();
  }
  /** Submitted orders past their confirm window — candidates for admin action. */
  async listExpired(): Promise<Order[]> {
    const now = Date.now();
    const submitted = await this.store.listOrdersByStatus('payment_submitted');
    return submitted.filter((o) => o.timeoutAt !== null && Date.parse(o.timeoutAt) < now);
  }

  /** Admin resolution of a disputed or timed-out order. Never automatic. */
  async adminResolve(args: { orderId: string; action: 'release' | 'cancel' }): Promise<Order> {
    const order = await this.requireOrder(args.orderId);
    if (order.status !== 'disputed' && order.status !== 'payment_submitted') {
      throw new P2PError(`order is ${order.status}, nothing to resolve`, 'CONFLICT');
    }
    return args.action === 'release' ? this.doRelease(order, ['payment_submitted', 'disputed']) : this.store.cancelOrder(order.id);
  }

  listMyOrders(partyId: string): Promise<Order[]> {
    return this.store.listOrdersByBuyer(partyId); // buyer view; merchant uses listMyOffers + order lookup
  }
  listOrdersForMerchant(merchantId: string): Promise<Order[]> {
    return this.store.listOrdersByMerchant(merchantId);
  }
  getOrder(id: string): Promise<Order | null> {
    return this.store.getOrder(id);
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Claim the order (status → released) ATOMICALLY first, then move the money.
   * The atomic claim makes release mutually exclusive with cancel/dispute — a
   * concurrent cancel can no longer restore the reservation after funds leave
   * escrow. If the (idempotent) ledger post fails, the claim is reverted so the
   * order can be retried. Escrow is guaranteed to hold the reserved amount here.
   */
  private async doRelease(order: Order, from: Order['status'][]): Promise<Order> {
    const claimed = await this.store.casUpdate(order.id, from, { status: 'released' });
    if (!claimed) throw new P2PError(`order is ${order.status}, cannot release`, 'CONFLICT');
    try {
      await this.ledger.p2pRelease({
        merchantId: order.merchantId,
        buyerId: order.buyerId,
        currency: order.asset,
        amountMinor: order.assetMinor,
        commissionMinor: order.commissionMinor,
        idempotencyKey: `p2p:release:${order.id}`,
        correlationId: order.id,
      });
    } catch (err) {
      await this.store.casUpdate(order.id, ['released'], { status: order.status }).catch(() => {});
      throw err;
    }
    return claimed;
  }

  private async requireOrder(id: string): Promise<Order> {
    const order = await this.store.getOrder(id);
    if (!order) throw new P2PError('order not found', 'NOT_FOUND');
    return order;
  }
}

function assertRate(rate: string): void {
  if (!/^\d+(\.\d+)?$/.test(rate.trim()) || Number(rate) <= 0) {
    throw new P2PError(`invalid price "${rate}"`, 'VALIDATION');
  }
}
