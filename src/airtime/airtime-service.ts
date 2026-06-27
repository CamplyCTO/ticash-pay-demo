import { Currency } from '../money/currency';
import { fromMinor, toMinor } from '../money/money';
import { applyBps } from '../fx/rate-service';
import { LedgerService } from '../ledger/service';
import { AirtimePort, PricedAirtimeProduct } from './types';
import { AirtimeMarginRecord, AirtimeMarginStore } from './margin-store';

/**
 * Orchestrates a mobile airtime top-up for ANY country, with a per-country margin:
 *   1. resolve the country's margin and debit the wallet RETAIL (cost + margin) — atomic
 *   2. send the airtime via the provider at COST
 *   3. on a provider failure, REVERSE the debit (refund retail)
 * The margin is the platform's revenue (booked to fee_revenue). Idempotent by the key.
 */
export class AirtimeService {
  constructor(
    private readonly port: AirtimePort,
    private readonly ledger: LedgerService,
    private readonly margins: AirtimeMarginStore,
  ) {}

  /** Provider products for a country, each priced with the margin + retail the customer pays. */
  async products(countryIso: string): Promise<PricedAirtimeProduct[]> {
    const [list, marginBps] = await Promise.all([this.port.products(countryIso), this.margins.get(countryIso)]);
    return list.map((p) => {
      const costMinor = toMinor(p.sendValue, 'BRL');
      const retailMinor = costMinor + applyBps(costMinor, marginBps);
      return { ...p, marginBps, retailValue: Number(fromMinor(retailMinor, 'BRL')) };
    });
  }

  balance() {
    return this.port.balance();
  }
  listMargins(): Promise<AirtimeMarginRecord[]> {
    return this.margins.list();
  }
  setMargin(countryIso: string, marginBps: number): Promise<AirtimeMarginRecord> {
    return this.margins.set(countryIso, marginBps);
  }

  async topup(args: {
    customerId: string;
    currency: Currency;
    countryIso: string;
    accountNumber: string;
    skuCode: string;
    costMinor: bigint; // provider cost (the SKU's sendValue)
    idempotencyKey: string;
  }): Promise<{ providerRef: string; transactionUid: string; costMinor: bigint; marginMinor: bigint; retailMinor: bigint }> {
    const marginBps = await this.margins.get(args.countryIso);
    const marginMinor = applyBps(args.costMinor, marginBps);
    const retailMinor = args.costMinor + marginMinor;

    // 1. debit the wallet RETAIL (atomic funds check; books cost->settlement, margin->fee_revenue)
    const debited = await this.ledger.airtimeTopup({
      customerId: args.customerId,
      currency: args.currency,
      costMinor: args.costMinor,
      marginMinor,
      idempotencyKey: args.idempotencyKey,
    });
    // 2. send the airtime at COST (the provider charges the SKU's sendValue, not the retail)
    try {
      const res = await this.port.send({
        accountNumber: args.accountNumber,
        skuCode: args.skuCode,
        sendValue: Number(fromMinor(args.costMinor, args.currency)),
        sendCurrency: args.currency,
        distributorRef: args.idempotencyKey,
      });
      return { providerRef: res.providerRef, transactionUid: debited.transactionUid, costMinor: args.costMinor, marginMinor, retailMinor };
    } catch (err) {
      // 3. provider failed -> refund the wallet (retail) and unwind cost + margin
      await this.ledger.reverseAirtime({
        customerId: args.customerId,
        currency: args.currency,
        costMinor: args.costMinor,
        marginMinor,
        idempotencyKey: `${args.idempotencyKey}:reverse`,
      });
      throw err;
    }
  }
}
