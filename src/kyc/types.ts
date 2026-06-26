/** KYC verification port. One interface, swappable provider: Sumsub now. */

export type KycReview = 'approved' | 'rejected' | 'review' | 'pending';

export interface KycStatusResult {
  externalUserId: string;
  applicantId?: string;
  review: KycReview; // normalized
  levelName?: string;
  raw: unknown;
}

export interface KycStartResult {
  token: string; // SDK access token for the frontend WebSDK
  userId: string;
  levelName: string;
  raw: unknown;
}

export interface KycPort {
  readonly name: string;
  /** Create/ensure an applicant and mint an SDK access token for the WebSDK. */
  startVerification(externalUserId: string, levelName: string): Promise<KycStartResult>;
  /** Pull the applicant's current, normalized review status. */
  getStatus(externalUserId: string): Promise<KycStatusResult>;
}
