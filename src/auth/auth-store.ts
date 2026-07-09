import { AppUser, CreateAppUserInput, CreateSessionInput, SaveOtpInput, Session } from './types';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'CONFLICT'
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'VALIDATION'
      | 'UNAUTHORIZED'
      | 'INVALID_OTP'
      | 'INVALID_REFRESH'
      | 'RATE_LIMITED' = 'VALIDATION',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * End-user auth persistence port. Adapters: in-memory (tests/demo, the executable
 * spec) and Postgres (production) — same pattern as the ledger/registry stores.
 * Times cross the port as ISO strings; only hashes (never raw codes/tokens) are stored.
 */
export interface AuthStore {
  createUser(input: CreateAppUserInput): Promise<AppUser>; // unique phone/email -> CONFLICT
  getUserById(id: string): Promise<AppUser | null>;
  getUserByPhone(phone: string): Promise<AppUser | null>;
  /** Login by email (case-insensitive). */
  getUserByEmail(email: string): Promise<AppUser | null>;
  /** All app_users linked to a party (customers/agents.external_id) — for push dispatch. */
  findUsersByExternalId(externalId: string): Promise<AppUser[]>;
  /** Set/replace the scrypt password hash (signup + password reset). */
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
  /** Mark the phone verified once the signup OTP is confirmed. */
  markPhoneVerified(userId: string): Promise<void>;

  saveOtp(input: SaveOtpInput): Promise<void>;
  /** Atomically consume the newest valid (unconsumed, unexpired) code for the phone. */
  consumeOtp(phone: string, codeHash: string, nowIso: string): Promise<boolean>;
  /** OTPs requested for this phone at/after `sinceIso` — for rate limiting. */
  countOtpsSince(phone: string, sinceIso: string): Promise<number>;

  createSession(input: CreateSessionInput): Promise<Session>;
  getSessionByRefreshHash(hash: string): Promise<Session | null>;
  /**
   * Rotate a session's refresh token, but ONLY if `oldHash` still matches and the
   * session is live. Returns false if another refresh already rotated it (token
   * reuse / a lost race) — the caller treats that as an invalid refresh. This is
   * what makes refresh-token rotation reuse-safe.
   */
  rotateSession(id: string, oldHash: string, newHash: string, newExpiresAt: string): Promise<boolean>;
  revokeSession(id: string, revokedAtIso: string): Promise<void>;
}
