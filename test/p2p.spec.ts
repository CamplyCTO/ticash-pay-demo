import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { InMemoryP2PStore } from '../src/p2p/p2p-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { P2PService } from '../src/p2p/p2p-service';
import { OtpSender } from '../src/auth/otp-sender';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }
const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class Sender implements OtpSender { readonly name = 'c'; last = ''; async send(_p: string, code: string) { this.last = code; } }

let app: ReturnType<typeof buildServer>;
let sender: Sender;

beforeEach(() => {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  const registry = new InMemoryRegistryStore();
  sender = new Sender();
  const p2p = new P2PService(ledger, new InMemoryP2PStore(), { asset: 'USDT', commissionBps: 200, confirmWindowMinutes: 30 });
  app = buildServer({
    ledger,
    registry,
    auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) },
    p2p: { service: p2p },
  });
});

function inj(o: { method: 'GET' | 'POST'; url: string; payload?: object; headers?: Record<string, string> }): Promise<InjectResponse> {
  return app.inject(o as never) as unknown as Promise<InjectResponse>;
}
const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
const get = (url: string, headers?: Record<string, string>) => inj({ method: 'GET', url, ...(headers ? { headers } : {}) });
const bal = async (q: string) => Number((await get('/accounts/balance?' + q)).json().balanceMinor);

async function loginCustomer(phone: string): Promise<{ ext: string; token: string }> {
  const r = await post('/app/auth/register', { phone });
  const ext = r.json().user.externalId as string;
  await post('/app/auth/otp', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.last });
  return { ext, token: `Bearer ${v.json().accessToken}` };
}
const fundUSDT = (customerId: string, amount: string) =>
  post('/transactions/fund-wallet', { customerId, currency: 'USDT', amount, idempotencyKey: `f:${customerId}:${amount}` });
const listOffer = (seller: { ext: string; token: string }, amount: string, price = '6.20') =>
  post('/app/p2p/offers', { fiatCurrency: 'BRL', pricePerUnit: price, amount, methods: [{ type: 'moncash', label: 'MonCash', account: '509-1234' }] }, { authorization: seller.token });

const wallet = (id: string) => `ownerType=customer&ownerId=${id}&kind=wallet&currency=USDT`;
const escrow = (id: string) => `ownerType=customer&ownerId=${id}&kind=p2p_escrow&currency=USDT`;
const feeRevenue = 'ownerType=system&kind=fee_revenue&currency=USDT';

describe('P2P USDT escrow marketplace (WS-4)', () => {
  it('full flow: list → order → pay → release moves USDT through escrow, and Σ=0', async () => {
    const seller = await loginCustomer('+5511900000001');
    const buyer = await loginCustomer('+5511900000002');
    await fundUSDT(seller.ext, '100.000000');
    expect(await bal(wallet(seller.ext))).toBe(100_000000);

    const offer = await listOffer(seller, '100.000000');
    expect(offer.statusCode).toBe(201);
    const offerId = offer.json().id;
    // Listing locked the full amount into escrow (wallet drained).
    expect(await bal(wallet(seller.ext))).toBe(0);
    expect(await bal(escrow(seller.ext))).toBe(100_000000);

    const order = await post('/app/p2p/orders', { offerId, amount: '50.000000' }, { authorization: buyer.token });
    expect(order.statusCode).toBe(201);
    const o = order.json();
    expect(BigInt(o.assetMinor)).toBe(50_000000n);
    expect(BigInt(o.commissionMinor)).toBe(1_000000n); // 2% of 50 USDT
    expect(BigInt(o.netToBuyerMinor)).toBe(49_000000n);
    expect(BigInt(o.fiatMinor)).toBe(31000n); // 50 × 6.20 = 310.00 BRL

    // No money has moved yet — only a reservation.
    expect(await bal(wallet(buyer.ext))).toBe(0);

    await post(`/app/p2p/orders/${o.id}/pay`, { proofRef: 'https://proof/img1' }, { authorization: buyer.token });
    const rel = await post(`/app/p2p/orders/${o.id}/release`, {}, { authorization: seller.token });
    expect(rel.json().status).toBe('released');

    expect(await bal(wallet(buyer.ext))).toBe(49_000000); // buyer received net USDT
    expect(await bal(feeRevenue)).toBe(1_000000); // platform earned the commission
    expect(await bal(escrow(seller.ext))).toBe(50_000000); // 50 still escrowed for the rest of the offer

    const recon = (await get('/reconciliation')).json();
    expect(recon.balanced).toBe(true);
    expect(recon.consistent).toBe(true);
  });

  it('escrow validates funds: a seller cannot list more USDT than they hold', async () => {
    const seller = await loginCustomer('+5511900000010');
    await fundUSDT(seller.ext, '100.000000');
    const r = await listOffer(seller, '150.000000');
    expect(r.statusCode).toBe(409); // INSUFFICIENT_FUNDS
    // The failed lock left nothing behind.
    expect(await bal(wallet(seller.ext))).toBe(100_000000);
    expect(await bal(escrow(seller.ext))).toBe(0);
  });

  it('reservation prevents overselling the same escrow', async () => {
    const seller = await loginCustomer('+5511900000020');
    const buyer = await loginCustomer('+5511900000021');
    await fundUSDT(seller.ext, '100.000000');
    const offerId = (await listOffer(seller, '100.000000')).json().id;
    expect((await post('/app/p2p/orders', { offerId, amount: '60.000000' }, { authorization: buyer.token })).statusCode).toBe(201);
    // Only 40 left — a second 60 order must be rejected.
    expect((await post('/app/p2p/orders', { offerId, amount: '60.000000' }, { authorization: buyer.token })).statusCode).toBe(409);
    expect((await post('/app/p2p/orders', { offerId, amount: '40.000000' }, { authorization: buyer.token })).statusCode).toBe(201);
  });

  it('cancelling before payment returns the reservation to the offer', async () => {
    const seller = await loginCustomer('+5511900000030');
    const buyer = await loginCustomer('+5511900000031');
    await fundUSDT(seller.ext, '100.000000');
    const offerId = (await listOffer(seller, '100.000000')).json().id;
    const order = (await post('/app/p2p/orders', { offerId, amount: '70.000000' }, { authorization: buyer.token })).json();
    // 30 available now.
    expect(BigInt((await get('/app/p2p/offers', { authorization: buyer.token })).json()[0].remainingMinor)).toBe(30_000000n);
    await post(`/app/p2p/orders/${order.id}/cancel`, {}, { authorization: buyer.token });
    // Back to 100 available; no USDT moved.
    expect(BigInt((await get('/app/p2p/offers', { authorization: buyer.token })).json()[0].remainingMinor)).toBe(100_000000n);
    expect(await bal(wallet(buyer.ext))).toBe(0);
  });

  it('a buyer cannot buy their own offer', async () => {
    const seller = await loginCustomer('+5511900000040');
    await fundUSDT(seller.ext, '10.000000');
    const offerId = (await listOffer(seller, '10.000000')).json().id;
    expect((await post('/app/p2p/orders', { offerId, amount: '5.000000' }, { authorization: seller.token })).statusCode).toBe(400);
  });

  it('a buyer who already reported payment must dispute, not cancel', async () => {
    const seller = await loginCustomer('+5511900000050');
    const buyer = await loginCustomer('+5511900000051');
    await fundUSDT(seller.ext, '10.000000');
    const offerId = (await listOffer(seller, '10.000000')).json().id;
    const order = (await post('/app/p2p/orders', { offerId, amount: '5.000000' }, { authorization: buyer.token })).json();
    await post(`/app/p2p/orders/${order.id}/pay`, { proofRef: 'p' }, { authorization: buyer.token });
    expect((await post(`/app/p2p/orders/${order.id}/cancel`, {}, { authorization: buyer.token })).statusCode).toBe(409);
  });

  it('dispute → admin releases the USDT to the buyer', async () => {
    const seller = await loginCustomer('+5511900000060');
    const buyer = await loginCustomer('+5511900000061');
    await fundUSDT(seller.ext, '10.000000');
    const offerId = (await listOffer(seller, '10.000000')).json().id;
    const order = (await post('/app/p2p/orders', { offerId, amount: '10.000000' }, { authorization: buyer.token })).json();
    await post(`/app/p2p/orders/${order.id}/pay`, { proofRef: 'p' }, { authorization: buyer.token });
    await post(`/app/p2p/orders/${order.id}/dispute`, { reason: 'seller not responding' }, { authorization: buyer.token });
    // Admin (no basic auth in tests) sees it and releases.
    const disputed = (await get('/p2p/orders?status=disputed')).json();
    expect(disputed.map((x: any) => x.id)).toContain(order.id);
    const resolved = await post(`/p2p/orders/${order.id}/resolve`, { action: 'release' });
    expect(resolved.json().status).toBe('released');
    expect(await bal(wallet(buyer.ext))).toBe(9_800000); // 10 - 2%
    expect((await get('/reconciliation')).json().balanced).toBe(true);
  });

  it('dispute → admin cancels: no USDT moves, reservation returns', async () => {
    const seller = await loginCustomer('+5511900000070');
    const buyer = await loginCustomer('+5511900000071');
    await fundUSDT(seller.ext, '10.000000');
    const offerId = (await listOffer(seller, '10.000000')).json().id;
    const order = (await post('/app/p2p/orders', { offerId, amount: '10.000000' }, { authorization: buyer.token })).json();
    await post(`/app/p2p/orders/${order.id}/pay`, { proofRef: 'p' }, { authorization: buyer.token });
    await post(`/app/p2p/orders/${order.id}/dispute`, { reason: 'no payment received' }, { authorization: buyer.token });
    const resolved = await post(`/p2p/orders/${order.id}/resolve`, { action: 'cancel' });
    expect(resolved.json().status).toBe('cancelled');
    expect(await bal(wallet(buyer.ext))).toBe(0);
    expect(await bal(escrow(seller.ext))).toBe(10_000000); // still fully escrowed
  });

  it('closing an offer returns the un-sold remainder to the seller; blocked while orders are open', async () => {
    const seller = await loginCustomer('+5511900000080');
    const buyer = await loginCustomer('+5511900000081');
    await fundUSDT(seller.ext, '100.000000');
    const offerId = (await listOffer(seller, '100.000000')).json().id;
    const order = (await post('/app/p2p/orders', { offerId, amount: '40.000000' }, { authorization: buyer.token })).json();
    // Cannot close with an open order.
    expect((await post(`/app/p2p/offers/${offerId}/close`, {}, { authorization: seller.token })).statusCode).toBe(409);
    await post(`/app/p2p/orders/${order.id}/cancel`, {}, { authorization: buyer.token });
    // Now closable — full 100 returns to the wallet.
    expect((await post(`/app/p2p/offers/${offerId}/close`, {}, { authorization: seller.token })).statusCode).toBe(200);
    expect(await bal(wallet(seller.ext))).toBe(100_000000);
    expect(await bal(escrow(seller.ext))).toBe(0);
  });

  it('a double-release cannot move funds twice', async () => {
    const seller = await loginCustomer('+5511900000090');
    const buyer = await loginCustomer('+5511900000091');
    await fundUSDT(seller.ext, '10.000000');
    const offerId = (await listOffer(seller, '10.000000')).json().id;
    const order = (await post('/app/p2p/orders', { offerId, amount: '10.000000' }, { authorization: buyer.token })).json();
    await post(`/app/p2p/orders/${order.id}/pay`, { proofRef: 'p' }, { authorization: buyer.token });
    expect((await post(`/app/p2p/orders/${order.id}/release`, {}, { authorization: seller.token })).statusCode).toBe(200);
    // Second release is rejected (already released) — buyer balance unchanged.
    expect((await post(`/app/p2p/orders/${order.id}/release`, {}, { authorization: seller.token })).statusCode).toBe(409);
    expect(await bal(wallet(buyer.ext))).toBe(9_800000);
  });

  it('an order is visible only to its buyer or seller (not a third party)', async () => {
    const seller = await loginCustomer('+5511900000100');
    const buyer = await loginCustomer('+5511900000101');
    const stranger = await loginCustomer('+5511900000102');
    await fundUSDT(seller.ext, '10.000000');
    const offerId = (await listOffer(seller, '10.000000')).json().id;
    const order = (await post('/app/p2p/orders', { offerId, amount: '5.000000' }, { authorization: buyer.token })).json();
    expect((await get(`/app/p2p/orders/${order.id}`, { authorization: buyer.token })).statusCode).toBe(200);
    expect((await get(`/app/p2p/orders/${order.id}`, { authorization: seller.token })).statusCode).toBe(200);
    expect((await get(`/app/p2p/orders/${order.id}`, { authorization: stranger.token })).statusCode).toBe(404);
  });

  it('the public offer list hides the merchant account number; the order reveals it', async () => {
    const seller = await loginCustomer('+5511900000110');
    const buyer = await loginCustomer('+5511900000111');
    await fundUSDT(seller.ext, '10.000000');
    const offerId = (await listOffer(seller, '10.000000')).json().id;
    const listed = (await get('/app/p2p/offers', { authorization: buyer.token })).json()[0];
    expect(listed.methods[0].label).toBe('MonCash');
    expect(listed.methods[0].account).toBeUndefined(); // PII withheld in the public list
    const order = (await post('/app/p2p/orders', { offerId, amount: '5.000000' }, { authorization: buyer.token })).json();
    expect(order.method.account).toBe('509-1234'); // revealed to the committed buyer
  });

  it('a submitted order past its confirm window is escalated to admin (never auto-released)', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    const store = new InMemoryP2PStore();
    const svc = new P2PService(ledger, store, { asset: 'USDT', commissionBps: 200, confirmWindowMinutes: -1 }); // already expired
    await ledger.fundWallet({ customerId: 'm1', currency: 'USDT', amountMinor: 10_000000n, idempotencyKey: 'f1' });
    const offer = await svc.createOffer({ merchantId: 'm1', fiatCurrency: 'BRL', pricePerUnit: '6', totalMinor: 10_000000n, methods: [{ type: 'moncash', label: 'MonCash', account: 'x' }] });
    const order = await svc.openOrder({ offerId: offer.id, buyerId: 'b1', assetMinor: 5_000000n });
    await svc.submitPayment({ orderId: order.id, buyerId: 'b1', proofRef: 'p' });
    const expired = await svc.listExpired();
    expect(expired.map((o) => o.id)).toContain(order.id);
    const resolved = await svc.adminResolve({ orderId: order.id, action: 'release' });
    expect(resolved.status).toBe('released');
    expect(await ledger.getBalance({ ownerType: 'customer', ownerId: 'b1', kind: 'wallet', currency: 'USDT' })).toBe(4_900000n);
  });
});
