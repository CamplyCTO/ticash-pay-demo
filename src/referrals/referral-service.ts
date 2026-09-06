import { randomInt } from 'node:crypto';
import { Currency } from '../money/currency';
import { LedgerService } from '../ledger/service';
import { SettingsStore } from '../settings/settings-store';
import { ReferralStats, ReferralStore } from './referral-store';

const BONUS_MINOR_KEY = 'referral.bonus.minor';
const BONUS_CCY_KEY = 'referral.bonus.currency';
const DEFAULT_BONUS_MINOR = 500n; // R$5.00
const DEFAULT_BONUS_CCY: Currency = 'BRL';

// Human-friendly code alphabet: no 0/O/1/I to avoid confusion when typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;

function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export interface ReferralBonus {
  amountMinor: bigint;
  currency: Currency;
}

export interface ReferralInfo {
  code: string;
  bonus: { amountMinor: string; currency: Currency };
  stats: ReferralStats;
}

/**
 * Referral / promo-code program. A user shares their code; when a NEW user signs up
 * with it AND makes their first real transaction, the REFERRER is credited a bonus.
 * The reward is gated on a real transaction (not signup) so fake accounts can't farm it.
 * The bonus amount + currency are admin-editable via the settings store.
 */
export class ReferralService {
  constructor(
    private readonly store: ReferralStore,
    private readonly ledger: LedgerService,
    private readonly settings?: SettingsStore,
  ) {}

  /** Current bonus (admin-editable; falls back to a sensible default). */
  async getBonus(): Promise<ReferralBonus> {
    const [m, c] = await Promise.all([this.settings?.get(BONUS_MINOR_KEY) ?? null, this.settings?.get(BONUS_CCY_KEY) ?? null]);
    const amountMinor = m && /^\d+$/.test(m) ? BigInt(m) : DEFAULT_BONUS_MINOR;
    return { amountMinor, currency: (c as Currency) || DEFAULT_BONUS_CCY };
  }

  /** Set the bonus (admin). amountMinor >= 0; 0 effectively disables new rewards. */
  async setBonus(amountMinor: bigint, currency: Currency): Promise<ReferralBonus> {
    if (amountMinor < 0n) throw new Error('bonus cannot be negative');
    await this.settings?.set(BONUS_MINOR_KEY, amountMinor.toString());
    await this.settings?.set(BONUS_CCY_KEY, currency);
    return this.getBonus();
  }

  /** Get-or-create the caller's shareable code (stable once allocated). */
  async codeFor(ownerExternalId: string): Promise<string> {
    const existing = await this.store.getCodeForOwner(ownerExternalId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = generateCode();
      try {
        await this.store.createCode(code, ownerExternalId);
        return code;
      } catch {
        // Either the code collided (retry) or the owner got a code concurrently (return it).
        const again = await this.store.getCodeForOwner(ownerExternalId);
        if (again) return again;
      }
    }
    throw new Error('could not allocate a referral code');
  }

  /** The caller's full referral panel: code + bonus + stats. */
  async infoFor(ownerExternalId: string): Promise<ReferralInfo> {
    const [code, bonus, stats] = await Promise.all([
      this.codeFor(ownerExternalId),
      this.getBonus(),
      this.store.statsForReferrer(ownerExternalId),
    ]);
    return { code, bonus: { amountMinor: bonus.amountMinor.toString(), currency: bonus.currency }, stats };
  }

  /**
   * Record a referral at signup. Best-effort: an unknown code, a self-referral, or an
   * already-referred user is silently ignored (never blocks signup). Codes are matched
   * case-insensitively.
   */
  async record(referredExternalId: string, code: string | null | undefined): Promise<void> {
    const c = (code ?? '').trim().toUpperCase();
    if (!c) return;
    const referrer = await this.store.ownerForCode(c);
    if (!referrer || referrer === referredExternalId) return;
    const existing = await this.store.getByReferred(referredExternalId);
    if (existing) return; // keep the first referral
    await this.store.createReferral(referredExternalId, referrer);
  }

  /**
   * Called when the referred user makes their first real transaction. Rewards the
   * referrer exactly once. Idempotent (ledger key + status guard), so it's safe to call
   * on every transaction — it no-ops after the first, and after the bonus is paid.
   */
  async onReferredUserTransacted(referredExternalId: string): Promise<void> {
    const ref = await this.store.getByReferred(referredExternalId);
    if (!ref || ref.status !== 'pending') return;
    const { amountMinor, currency } = await this.getBonus();
    if (amountMinor <= 0n) return; // bonus disabled — leave pending for when it's re-enabled
    await this.ledger.referralReward({
      referrerId: ref.referrerExternalId,
      currency,
      amountMinor,
      idempotencyKey: `referral:${referredExternalId}`, // one payout per referred user
      externalRef: referredExternalId,
    });
    await this.store.markRewarded(referredExternalId, amountMinor, currency);
  }
}
