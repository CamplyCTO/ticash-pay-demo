import { RegistryStore } from '../registry/store';
import { KycPort } from './types';

/**
 * Orchestrates KYC: mint an SDK token to start verification, and sync the provider's
 * review result back onto the customer's kyc_level / kyc_status in the registry.
 * Mapping: approved -> level 2 (full); rejected/review/pending leave the level unchanged.
 */
export class KycService {
  constructor(
    private readonly port: KycPort,
    private readonly registry: RegistryStore,
    private readonly levelName: string,
  ) {}

  /** Start verification for a customer; returns the WebSDK access token for the frontend. */
  start(externalUserId: string) {
    return this.port.startVerification(externalUserId, this.levelName);
  }

  /** Pull the latest review from the provider and persist it on the customer. */
  async sync(externalUserId: string) {
    const st = await this.port.getStatus(externalUserId);
    const kycStatus = st.review; // 'approved' | 'rejected' | 'review' | 'pending'
    const existing = await this.registry.getCustomer(externalUserId);
    const kycLevel = st.review === 'approved' ? 2 : existing?.kycLevel ?? 0;
    const customer = existing
      ? await this.registry.setCustomerKyc(externalUserId, kycLevel, kycStatus)
      : await this.registry.createCustomer({ externalId: externalUserId, kycLevel, kycStatus });
    return { review: st.review, kycLevel, kycStatus, applicantId: st.applicantId, customer };
  }
}
