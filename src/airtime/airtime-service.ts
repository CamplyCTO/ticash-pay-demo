import { Currency } from '../money/currency';
import { fromMinor } from '../money/money';
import { LedgerService } from '../ledger/service';
import { AirtimePort, AirtimeProduct } from './types';

/**
 * Orchestrates a mobile airtime top-up safely:
 *   1. debit the customer wallet (atomic — throws INSUFFICIENT_FUNDS if short)
 *   2. send the airtime via the provider
 *   3. on a provider failure, REVERSE the debit (refund the wallet)
 * Idempotent by the caller's key (also the provider's DistributorRef).
 */
export class AirtimeService {
  constructor(private readonly port: AirtimePort, private readonly ledger: LedgerService) {}

  products(countryIso: string): Promise<AirtimeProduct[]> {
    return this.port.products(countryIso);
  }
  balance() {
    return this.port.balance();
  }

  async topup(args: {
    customerId: string;
    currency: Currency;
    accountNumber: string;
    skuCode: string;
    amountMinor: bigint;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; transactionUid: string; amountMinor: bigint }> {
    // 1. debit the wallet first (atomic funds check)
    const debited = await this.ledger.airtimeTopup({
      customerId: args.customerId,
      currency: args.currency,
      amountMinor: args.amountMinor,
      idempotencyKey: args.idempotencyKey,
    });
    // 2. send the airtime
    try {
      const res = await this.port.send({
        accountNumber: args.accountNumber,
        skuCode: args.skuCode,
        sendValue: Number(fromMinor(args.amountMinor, args.currency)),
        sendCurrency: args.currency,
        distributorRef: args.idempotencyKey,
      });
      return { providerRef: res.providerRef, transactionUid: debited.transactionUid, amountMinor: args.amountMinor };
    } catch (err) {
      // 3. provider failed -> refund the wallet
      await this.ledger.reverseAirtime({
        customerId: args.customerId,
        currency: args.currency,
        amountMinor: args.amountMinor,
        idempotencyKey: `${args.idempotencyKey}:reverse`,
      });
      throw err;
    }
  }
}
