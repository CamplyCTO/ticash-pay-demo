import { Currency } from '../money/currency';
import { toMinor } from '../money/money';
import { RegistryError, RegistryStore } from '../registry/store';

/**
 * Per-transaction limits tied to a customer's KYC level (the contract's "níveis
 * ligados a limites de transação"). A higher KYC level unlocks a higher cap.
 * Unregistered/unverified ids fall to level 0 (the most restrictive cap).
 */
export class KycLimits {
  constructor(
    private readonly registry: RegistryStore,
    private readonly limitByLevel: Record<number, number>,
  ) {}

  capForLevel(level: number): number {
    return this.limitByLevel[level] ?? this.limitByLevel[0] ?? 0;
  }

  /** Throws LIMIT_EXCEEDED (422) when the amount is above the customer's KYC cap. */
  async assertWithinLimit(customerId: string, amountMinor: bigint, currency: Currency): Promise<void> {
    const c = await this.registry.getCustomer(customerId);
    const level = c?.kycLevel ?? 0;
    const cap = this.capForLevel(level);
    const capMinor = toMinor(cap, currency);
    if (amountMinor > capMinor) {
      throw new RegistryError(
        `amount exceeds KYC level ${level} limit of ${cap} ${currency} — complete verification to raise it`,
        'LIMIT_EXCEEDED',
      );
    }
  }

  /** The configured caps, for display (GET /kyc/limits). */
  table(): Array<{ level: number; cap: number }> {
    return Object.keys(this.limitByLevel)
      .map(Number)
      .sort((a, b) => a - b)
      .map((level) => ({ level, cap: this.capForLevel(level) }));
  }
}
