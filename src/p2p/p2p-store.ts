import { Pool } from 'pg';
import { assertCurrency } from '../money/currency';
import {
  ACTIVE_ORDER,
  CANCELLABLE,
  NewOffer,
  NewOrder,
  Offer,
  Order,
  OrderPatch,
  OrderStatus,
  PaymentMethod,
} from './types';

export type P2PErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'FORBIDDEN';

/** Domain error; `code` maps to an HTTP status in the server error handler. */
export class P2PError extends Error {
  constructor(message: string, readonly code: P2PErrorCode) {
    super(message);
    this.name = 'P2PError';
  }
}

/**
 * Persistence port for the P2P marketplace. Reservation and cancellation are
 * ATOMIC (they move availability between an offer and its orders) so two buyers
 * can never over-reserve the same escrow. Adapters: in-memory + Postgres.
 */
export interface P2PStore {
  createOffer(o: NewOffer): Promise<Offer>;
  getOffer(id: string): Promise<Offer | null>;
  listActiveOffers(): Promise<Offer[]>;
  listOffersByMerchant(merchantId: string): Promise<Offer[]>;
  /** Close an active, seller-owned offer. Returns it (with the remainder to unlock) or null. */
  closeOffer(id: string, merchantId: string): Promise<Offer | null>;

  /** Atomically reserve `assetMinor` from the offer and insert the order. Throws on inactive/insufficient. */
  createOrder(o: NewOrder): Promise<Order>;
  getOrder(id: string): Promise<Order | null>;
  listOrdersByBuyer(buyerId: string): Promise<Order[]>;
  listOrdersByMerchant(merchantId: string): Promise<Order[]>;
  listOrdersByStatus(status: OrderStatus): Promise<Order[]>;
  /** All orders, newest first — admin oversight of every settlement. */
  listAllOrders(): Promise<Order[]>;
  updateOrder(id: string, patch: OrderPatch): Promise<Order>;
  /**
   * Atomically apply `patch` (including the new status) ONLY IF the order's
   * current status is one of `from`. Returns the updated order, or null if the
   * status no longer matches (lost the race). This serializes release/cancel/
   * dispute/pay so two of them can never both take effect.
   */
  casUpdate(id: string, from: OrderStatus[], patch: OrderPatch & { status: OrderStatus }): Promise<Order | null>;
  /** Atomically cancel a cancellable order and return its reservation to the offer. */
  cancelOrder(id: string): Promise<Order>;
  /** Are there orders still holding escrow against this offer? (blocks close) */
  hasActiveOrders(offerId: string): Promise<boolean>;
  /** Store/replace the buyer's payment-proof image for an order. */
  saveProof(orderUid: string, image: Buffer, contentType: string): Promise<void>;
  /** Fetch an order's payment-proof image, if any. */
  getProof(orderUid: string): Promise<{ image: Buffer; contentType: string } | null>;
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests / demo). Single-threaded ⇒ each method is atomic.
// ---------------------------------------------------------------------------
export class InMemoryP2PStore implements P2PStore {
  private readonly offers = new Map<string, Offer>();
  private readonly orders = new Map<string, Order>();
  private readonly proofs = new Map<string, { image: Buffer; contentType: string }>();

  async createOffer(o: NewOffer): Promise<Offer> {
    const offer: Offer = {
      ...o,
      remainingMinor: o.totalMinor,
      methods: o.methods,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.offers.set(o.id, offer);
    return clone(offer);
  }
  async getOffer(id: string): Promise<Offer | null> {
    const o = this.offers.get(id);
    return o ? clone(o) : null;
  }
  async listActiveOffers(): Promise<Offer[]> {
    return [...this.offers.values()].filter((o) => o.status === 'active' && o.remainingMinor > 0n).map(clone);
  }
  async listOffersByMerchant(merchantId: string): Promise<Offer[]> {
    return [...this.offers.values()].filter((o) => o.merchantId === merchantId).map(clone);
  }
  async closeOffer(id: string, merchantId: string): Promise<Offer | null> {
    const o = this.offers.get(id);
    if (!o || o.merchantId !== merchantId || o.status !== 'active') return null;
    o.status = 'closed';
    return clone(o);
  }

  async createOrder(o: NewOrder): Promise<Order> {
    const offer = this.offers.get(o.offerId);
    if (!offer) throw new P2PError(`offer ${o.offerId} not found`, 'NOT_FOUND');
    if (offer.status !== 'active') throw new P2PError('offer is not active', 'CONFLICT');
    if (o.assetMinor <= 0n) throw new P2PError('amount must be positive', 'VALIDATION');
    if (offer.remainingMinor < o.assetMinor) throw new P2PError('offer does not have enough available', 'CONFLICT');
    offer.remainingMinor -= o.assetMinor; // reserve
    const now = new Date().toISOString();
    const order: Order = {
      ...o,
      status: 'created',
      proofRef: null,
      disputeReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(o.id, order);
    return clone(order);
  }
  async getOrder(id: string): Promise<Order | null> {
    const o = this.orders.get(id);
    return o ? clone(o) : null;
  }
  async listOrdersByBuyer(buyerId: string): Promise<Order[]> {
    return [...this.orders.values()].filter((o) => o.buyerId === buyerId).map(clone);
  }
  async listOrdersByMerchant(merchantId: string): Promise<Order[]> {
    return [...this.orders.values()].filter((o) => o.merchantId === merchantId).map(clone);
  }
  async listOrdersByStatus(status: OrderStatus): Promise<Order[]> {
    return [...this.orders.values()].filter((o) => o.status === status).map(clone);
  }
  async listAllOrders(): Promise<Order[]> {
    return [...this.orders.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(clone);
  }
  async updateOrder(id: string, patch: OrderPatch): Promise<Order> {
    const o = this.orders.get(id);
    if (!o) throw new P2PError(`order ${id} not found`, 'NOT_FOUND');
    if (patch.status !== undefined) o.status = patch.status;
    if (patch.proofRef !== undefined) o.proofRef = patch.proofRef;
    if (patch.disputeReason !== undefined) o.disputeReason = patch.disputeReason;
    if (patch.timeoutAt !== undefined) o.timeoutAt = patch.timeoutAt;
    o.updatedAt = new Date().toISOString();
    return clone(o);
  }
  async casUpdate(id: string, from: OrderStatus[], patch: OrderPatch & { status: OrderStatus }): Promise<Order | null> {
    const o = this.orders.get(id);
    if (!o || !from.includes(o.status)) return null;
    o.status = patch.status;
    if (patch.proofRef !== undefined) o.proofRef = patch.proofRef;
    if (patch.disputeReason !== undefined) o.disputeReason = patch.disputeReason;
    if (patch.timeoutAt !== undefined) o.timeoutAt = patch.timeoutAt;
    o.updatedAt = new Date().toISOString();
    return clone(o);
  }
  async cancelOrder(id: string): Promise<Order> {
    const o = this.orders.get(id);
    if (!o) throw new P2PError(`order ${id} not found`, 'NOT_FOUND');
    if (!CANCELLABLE.has(o.status)) throw new P2PError(`order ${id} cannot be cancelled (${o.status})`, 'CONFLICT');
    o.status = 'cancelled';
    o.updatedAt = new Date().toISOString();
    const offer = this.offers.get(o.offerId);
    if (offer) offer.remainingMinor += o.assetMinor; // give the reservation back
    return clone(o);
  }
  async hasActiveOrders(offerId: string): Promise<boolean> {
    return [...this.orders.values()].some((o) => o.offerId === offerId && ACTIVE_ORDER.has(o.status));
  }
  async saveProof(orderUid: string, image: Buffer, contentType: string): Promise<void> {
    this.proofs.set(orderUid, { image: Buffer.from(image), contentType });
  }
  async getProof(orderUid: string): Promise<{ image: Buffer; contentType: string } | null> {
    const p = this.proofs.get(orderUid);
    return p ? { image: Buffer.from(p.image), contentType: p.contentType } : null;
  }
}

/** Deep copy so callers can't mutate the store's held objects. structuredClone
 *  preserves BigInt (unlike JSON) and deep-copies the nested methods/method. */
function clone<T>(v: T): T {
  return structuredClone(v);
}

// ---------------------------------------------------------------------------
// Postgres adapter. Reservation / cancellation run in a single transaction with
// a row lock on the offer, so concurrent buyers cannot over-reserve.
// ---------------------------------------------------------------------------
export class PgP2PStore implements P2PStore {
  constructor(private readonly pool: Pool) {}

  async createOffer(o: NewOffer): Promise<Offer> {
    const res = await this.pool.query(
      `INSERT INTO p2p_offers (offer_uid, merchant_id, asset, fiat_currency, price_per_unit, total_minor, remaining_minor, min_fiat_minor, max_fiat_minor, pay_window_min, methods)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)
       RETURNING *`,
      [o.id, o.merchantId, o.asset, o.fiatCurrency, o.pricePerUnit, o.totalMinor.toString(), o.minFiatMinor === null ? null : o.minFiatMinor.toString(), o.maxFiatMinor === null ? null : o.maxFiatMinor.toString(), o.payWindowMin, JSON.stringify(o.methods)],
    );
    return mapOffer(res.rows[0]);
  }
  async getOffer(id: string): Promise<Offer | null> {
    const res = await this.pool.query(`SELECT * FROM p2p_offers WHERE offer_uid = $1`, [id]);
    return res.rows[0] ? mapOffer(res.rows[0]) : null;
  }
  async listActiveOffers(): Promise<Offer[]> {
    const res = await this.pool.query(
      `SELECT * FROM p2p_offers WHERE status = 'active' AND remaining_minor > 0 ORDER BY created_at DESC`,
    );
    return res.rows.map(mapOffer);
  }
  async listOffersByMerchant(merchantId: string): Promise<Offer[]> {
    const res = await this.pool.query(`SELECT * FROM p2p_offers WHERE merchant_id = $1 ORDER BY created_at DESC`, [merchantId]);
    return res.rows.map(mapOffer);
  }
  async closeOffer(id: string, merchantId: string): Promise<Offer | null> {
    const res = await this.pool.query(
      `UPDATE p2p_offers SET status = 'closed' WHERE offer_uid = $1 AND merchant_id = $2 AND status = 'active' RETURNING *`,
      [id, merchantId],
    );
    return res.rows[0] ? mapOffer(res.rows[0]) : null;
  }

  async createOrder(o: NewOrder): Promise<Order> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const off = await client.query(`SELECT status, remaining_minor FROM p2p_offers WHERE offer_uid = $1 FOR UPDATE`, [o.offerId]);
      if (!off.rows[0]) throw new P2PError(`offer ${o.offerId} not found`, 'NOT_FOUND');
      if (off.rows[0].status !== 'active') throw new P2PError('offer is not active', 'CONFLICT');
      if (o.assetMinor <= 0n) throw new P2PError('amount must be positive', 'VALIDATION');
      if (BigInt(off.rows[0].remaining_minor) < o.assetMinor) throw new P2PError('offer does not have enough available', 'CONFLICT');
      await client.query(`UPDATE p2p_offers SET remaining_minor = remaining_minor - $2 WHERE offer_uid = $1`, [o.offerId, o.assetMinor.toString()]);
      const res = await client.query(
        `INSERT INTO p2p_orders (order_uid, offer_uid, merchant_id, buyer_id, asset, asset_minor, commission_minor, net_to_buyer_minor, fiat_currency, fiat_minor, price_per_unit, method, timeout_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [o.id, o.offerId, o.merchantId, o.buyerId, o.asset, o.assetMinor.toString(), o.commissionMinor.toString(), o.netToBuyerMinor.toString(), o.fiatCurrency, o.fiatMinor.toString(), o.pricePerUnit, JSON.stringify(o.method), o.timeoutAt],
      );
      await client.query('COMMIT');
      return mapOrder(res.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async getOrder(id: string): Promise<Order | null> {
    const res = await this.pool.query(`SELECT * FROM p2p_orders WHERE order_uid = $1`, [id]);
    return res.rows[0] ? mapOrder(res.rows[0]) : null;
  }
  async listOrdersByBuyer(buyerId: string): Promise<Order[]> {
    const res = await this.pool.query(`SELECT * FROM p2p_orders WHERE buyer_id = $1 ORDER BY created_at DESC`, [buyerId]);
    return res.rows.map(mapOrder);
  }
  async listOrdersByMerchant(merchantId: string): Promise<Order[]> {
    const res = await this.pool.query(`SELECT * FROM p2p_orders WHERE merchant_id = $1 ORDER BY created_at DESC`, [merchantId]);
    return res.rows.map(mapOrder);
  }
  async listOrdersByStatus(status: OrderStatus): Promise<Order[]> {
    const res = await this.pool.query(`SELECT * FROM p2p_orders WHERE status = $1 ORDER BY created_at DESC`, [status]);
    return res.rows.map(mapOrder);
  }
  async listAllOrders(): Promise<Order[]> {
    const res = await this.pool.query(`SELECT * FROM p2p_orders ORDER BY created_at DESC LIMIT 500`);
    return res.rows.map(mapOrder);
  }
  async updateOrder(id: string, patch: OrderPatch): Promise<Order> {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.proofRef !== undefined) add('proof_ref', patch.proofRef);
    if (patch.disputeReason !== undefined) add('dispute_reason', patch.disputeReason);
    if (patch.timeoutAt !== undefined) add('timeout_at', patch.timeoutAt);
    sets.push('updated_at = now()');
    const res = await this.pool.query(`UPDATE p2p_orders SET ${sets.join(', ')} WHERE order_uid = $1 RETURNING *`, vals);
    if (!res.rows[0]) throw new P2PError(`order ${id} not found`, 'NOT_FOUND');
    return mapOrder(res.rows[0]);
  }
  async casUpdate(id: string, from: OrderStatus[], patch: OrderPatch & { status: OrderStatus }): Promise<Order | null> {
    const sets = ['status = $3'];
    const vals: unknown[] = [id, from, patch.status];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.proofRef !== undefined) add('proof_ref', patch.proofRef);
    if (patch.disputeReason !== undefined) add('dispute_reason', patch.disputeReason);
    if (patch.timeoutAt !== undefined) add('timeout_at', patch.timeoutAt);
    sets.push('updated_at = now()');
    const res = await this.pool.query(
      `UPDATE p2p_orders SET ${sets.join(', ')} WHERE order_uid = $1 AND status = ANY($2) RETURNING *`,
      vals,
    );
    return res.rows[0] ? mapOrder(res.rows[0]) : null;
  }
  async cancelOrder(id: string): Promise<Order> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE p2p_orders SET status = 'cancelled', updated_at = now()
         WHERE order_uid = $1 AND status IN ('created','payment_submitted','disputed') RETURNING *`,
        [id],
      );
      if (!res.rows[0]) {
        // Distinguish missing vs not-cancellable for a clean error.
        const exists = await client.query(`SELECT 1 FROM p2p_orders WHERE order_uid = $1`, [id]);
        await client.query('ROLLBACK');
        throw new P2PError(exists.rows[0] ? `order ${id} cannot be cancelled` : `order ${id} not found`, exists.rows[0] ? 'CONFLICT' : 'NOT_FOUND');
      }
      const order = mapOrder(res.rows[0]);
      await client.query(`UPDATE p2p_offers SET remaining_minor = remaining_minor + $2 WHERE offer_uid = $1`, [order.offerId, order.assetMinor.toString()]);
      await client.query('COMMIT');
      return order;
    } catch (err) {
      if (!(err instanceof P2PError)) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  async hasActiveOrders(offerId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM p2p_orders WHERE offer_uid = $1 AND status IN ('created','payment_submitted','disputed') LIMIT 1`,
      [offerId],
    );
    return res.rows.length > 0;
  }
  async saveProof(orderUid: string, image: Buffer, contentType: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO p2p_order_proofs (order_uid, image, content_type) VALUES ($1,$2,$3)
       ON CONFLICT (order_uid) DO UPDATE SET image = EXCLUDED.image, content_type = EXCLUDED.content_type, created_at = now()`,
      [orderUid, image, contentType],
    );
  }
  async getProof(orderUid: string): Promise<{ image: Buffer; contentType: string } | null> {
    const res = await this.pool.query(`SELECT image, content_type FROM p2p_order_proofs WHERE order_uid = $1`, [orderUid]);
    return res.rows[0] ? { image: res.rows[0].image as Buffer, contentType: res.rows[0].content_type } : null;
  }
}

function mapOffer(r: any): Offer {
  return {
    id: r.offer_uid,
    merchantId: r.merchant_id,
    asset: assertCurrency(r.asset.trim()), // CHAR(n) is space-padded on read
    fiatCurrency: assertCurrency(r.fiat_currency.trim()),
    pricePerUnit: r.price_per_unit,
    totalMinor: BigInt(r.total_minor),
    remainingMinor: BigInt(r.remaining_minor),
    minFiatMinor: r.min_fiat_minor === null || r.min_fiat_minor === undefined ? null : BigInt(r.min_fiat_minor),
    maxFiatMinor: r.max_fiat_minor === null || r.max_fiat_minor === undefined ? null : BigInt(r.max_fiat_minor),
    payWindowMin: r.pay_window_min ?? 15,
    methods: (typeof r.methods === 'string' ? JSON.parse(r.methods) : r.methods) as PaymentMethod[],
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

function mapOrder(r: any): Order {
  return {
    id: r.order_uid,
    offerId: r.offer_uid,
    merchantId: r.merchant_id,
    buyerId: r.buyer_id,
    asset: assertCurrency(r.asset.trim()), // CHAR(n) is space-padded on read
    assetMinor: BigInt(r.asset_minor),
    commissionMinor: BigInt(r.commission_minor),
    netToBuyerMinor: BigInt(r.net_to_buyer_minor),
    fiatCurrency: assertCurrency(r.fiat_currency.trim()),
    fiatMinor: BigInt(r.fiat_minor),
    pricePerUnit: r.price_per_unit,
    method: (typeof r.method === 'string' ? JSON.parse(r.method) : r.method) as PaymentMethod,
    status: r.status,
    proofRef: r.proof_ref ?? null,
    disputeReason: r.dispute_reason ?? null,
    timeoutAt: r.timeout_at ? r.timeout_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
