import { Currency } from '../money/currency';

export type ReferralStatus = 'pending' | 'rewarded';

export interface ReferralRecord {
  referredExternalId: string;
  referrerExternalId: string;
  status: ReferralStatus;
  rewardMinor: bigint | null;
  rewardCurrency: Currency | null;
}

export interface ReferralStats {
  referredCount: number; // people who signed up with this user's code
  rewardedCount: number; // of those, how many triggered the bonus (became active)
  earnedMinor: Record<string, string>; // currency -> total minor earned (bigint as string)
}

/** Persistence port for the referral program. Two concerns: a user's shareable
 *  code, and the referral edges (who referred whom + reward state). */
export interface ReferralStore {
  // ---- codes ----
  /** The owner's existing code, or null if none allocated yet. */
  getCodeForOwner(ownerExternalId: string): Promise<string | null>;
  /** Allocate a code for an owner. Throws if the code OR the owner already exists. */
  createCode(code: string, ownerExternalId: string): Promise<void>;
  /** The owner an active code belongs to, or null for an unknown code. */
  ownerForCode(code: string): Promise<string | null>;

  // ---- referral edges ----
  /** Record that `referred` was referred by `referrer`. No-op if one already exists. */
  createReferral(referredExternalId: string, referrerExternalId: string): Promise<void>;
  getByReferred(referredExternalId: string): Promise<ReferralRecord | null>;
  /** Flip a pending referral to rewarded, stamping the paid amount. */
  markRewarded(referredExternalId: string, rewardMinor: bigint, rewardCurrency: Currency): Promise<void>;
  statsForReferrer(referrerExternalId: string): Promise<ReferralStats>;
}

interface Code { code: string; owner: string }

export class InMemoryReferralStore implements ReferralStore {
  private readonly codes: Code[] = [];
  private readonly referrals = new Map<string, ReferralRecord>();

  async getCodeForOwner(ownerExternalId: string): Promise<string | null> {
    return this.codes.find((c) => c.owner === ownerExternalId)?.code ?? null;
  }
  async createCode(code: string, ownerExternalId: string): Promise<void> {
    if (this.codes.some((c) => c.code === code || c.owner === ownerExternalId)) {
      throw new Error('referral code or owner already exists');
    }
    this.codes.push({ code, owner: ownerExternalId });
  }
  async ownerForCode(code: string): Promise<string | null> {
    return this.codes.find((c) => c.code === code)?.owner ?? null;
  }

  async createReferral(referredExternalId: string, referrerExternalId: string): Promise<void> {
    if (this.referrals.has(referredExternalId)) return;
    this.referrals.set(referredExternalId, {
      referredExternalId,
      referrerExternalId,
      status: 'pending',
      rewardMinor: null,
      rewardCurrency: null,
    });
  }
  async getByReferred(referredExternalId: string): Promise<ReferralRecord | null> {
    return this.referrals.get(referredExternalId) ?? null;
  }
  async markRewarded(referredExternalId: string, rewardMinor: bigint, rewardCurrency: Currency): Promise<void> {
    const r = this.referrals.get(referredExternalId);
    if (!r || r.status === 'rewarded') return;
    r.status = 'rewarded';
    r.rewardMinor = rewardMinor;
    r.rewardCurrency = rewardCurrency;
  }
  async statsForReferrer(referrerExternalId: string): Promise<ReferralStats> {
    const mine = [...this.referrals.values()].filter((r) => r.referrerExternalId === referrerExternalId);
    const earned: Record<string, bigint> = {};
    let rewardedCount = 0;
    for (const r of mine) {
      if (r.status === 'rewarded' && r.rewardMinor && r.rewardCurrency) {
        rewardedCount++;
        earned[r.rewardCurrency] = (earned[r.rewardCurrency] ?? 0n) + r.rewardMinor;
      }
    }
    return {
      referredCount: mine.length,
      rewardedCount,
      earnedMinor: Object.fromEntries(Object.entries(earned).map(([k, v]) => [k, v.toString()])),
    };
  }
}
