import { Currency } from '../money/currency';
import { LedgerService } from '../ledger/service';
import { PayoutStore } from './payout-store';

/**
 * Provider-fee reconciliation. Two layers:
 *  1. INTERNAL consistency — the sum of the fee LOCKED on each settled payout must equal
 *     the balance the ledger accrued in the `provider_fee` account (per currency). If
 *     these diverge, a settlement posted a different fee than the payout recorded → bug.
 *  2. EXTERNAL match — compare our recorded fee for a provider/currency against the
 *     figure on the provider's own settlement statement (e.g. BenCash) → delta.
 */
export interface ProviderFeeGroup {
  provider: string;
  currency: Currency;
  settledCount: number;
  totalGrossMinor: bigint;
  totalProviderFeeMinor: bigint;
  totalNetToRecipientMinor: bigint;
}
export interface ConsistencyRow {
  currency: Currency;
  payoutSumMinor: bigint; // Σ providerFeeMinor over settled payouts
  ledgerBalanceMinor: bigint; // provider_fee account balance
  matches: boolean;
}
export interface ProviderFeeReport {
  byProvider: ProviderFeeGroup[];
  consistency: ConsistencyRow[];
  consistent: boolean;
}
export interface MatchResult {
  provider: string;
  currency: Currency;
  settledCount: number;
  ourMinor: bigint;
  reportedMinor: bigint;
  deltaMinor: bigint; // ours − reported (positive ⇒ we recorded more)
  matches: boolean;
}

export class ProviderFeeReconciliation {
  constructor(private readonly payouts: PayoutStore, private readonly ledger: LedgerService) {}

  async report(): Promise<ProviderFeeReport> {
    const settled = (await this.payouts.list()).filter((p) => p.status === 'settled');

    const groups = new Map<string, ProviderFeeGroup>();
    for (const p of settled) {
      const key = `${p.provider}|${p.currency}`;
      const g =
        groups.get(key) ??
        { provider: p.provider, currency: p.currency, settledCount: 0, totalGrossMinor: 0n, totalProviderFeeMinor: 0n, totalNetToRecipientMinor: 0n };
      g.settledCount += 1;
      g.totalGrossMinor += p.amountMinor;
      g.totalProviderFeeMinor += p.providerFeeMinor;
      g.totalNetToRecipientMinor += p.amountMinor - p.providerFeeMinor;
      groups.set(key, g);
    }
    const byProvider = [...groups.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.currency.localeCompare(b.currency));

    // Cross-check the per-payout fee sum against the ledger's accrued provider_fee balance.
    const payoutSum = new Map<string, bigint>();
    for (const g of byProvider) payoutSum.set(g.currency, (payoutSum.get(g.currency) ?? 0n) + g.totalProviderFeeMinor);
    const ledgerBal = new Map<string, bigint>();
    for (const b of await this.ledger.listBalances()) {
      if (b.kind === 'provider_fee') ledgerBal.set(b.currency, b.balanceMinor);
    }
    const currencies = new Set<string>([...payoutSum.keys(), ...ledgerBal.keys()]);
    const consistency: ConsistencyRow[] = [...currencies].sort().map((ccy) => {
      const payoutSumMinor = payoutSum.get(ccy) ?? 0n;
      const ledgerBalanceMinor = ledgerBal.get(ccy) ?? 0n;
      return { currency: ccy as Currency, payoutSumMinor, ledgerBalanceMinor, matches: payoutSumMinor === ledgerBalanceMinor };
    });

    return { byProvider, consistency, consistent: consistency.every((c) => c.matches) };
  }

  /** Compare our recorded provider fee against the provider's reported total. */
  async match(provider: string, currency: Currency, reportedMinor: bigint): Promise<MatchResult> {
    const { byProvider } = await this.report();
    const g = byProvider.find((x) => x.provider === provider && x.currency === currency);
    const ourMinor = g?.totalProviderFeeMinor ?? 0n;
    return {
      provider,
      currency,
      settledCount: g?.settledCount ?? 0,
      ourMinor,
      reportedMinor,
      deltaMinor: ourMinor - reportedMinor,
      matches: ourMinor === reportedMinor,
    };
  }
}
