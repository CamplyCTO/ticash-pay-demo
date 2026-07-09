import { randomBytes } from 'node:crypto';
import { RegistryError, RegistryStore } from '../registry/store';
import { AuthError, AuthStore } from './auth-store';
import { OtpSender } from './otp-sender';
import { Verifier } from './verifier';
import { hashPassword, verifyPassword } from './password';
import { JwtClaims, newOtpCode, newRefreshToken, sha256Hex, signAccessToken, verifyAccessToken } from './tokens';
import { AppUser } from './types';

/** A fixed invalid hash: verify against it when a login handle is unknown so the
 *  response time doesn't reveal whether an account exists (anti-enumeration). */
const DUMMY_HASH = hashPassword('ticash-dummy-password');

export interface AuthConfig {
  jwtSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  otpTtlSec: number;
  otpLength: number;
  otpMaxPerHour: number;
}

/** What the apps get back on a successful login. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access-token TTL (seconds)
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  role: 'customer' | 'agent';
  externalId: string;
  phone: string;
}

/**
 * End-user authentication for the mobile apps. Phone + OTP login issuing short-lived
 * JWT access tokens + rotating opaque refresh tokens.
 *
 * - A customer **self-signup creates a `customers` row** (via the registry) AND the
 *   linked `app_users` row — not just a link to a pre-existing customer.
 * - **Agents are admin-provisioned** (`provisionAgentLogin`): their login links to an
 *   agent the admin already created; agents do not self-register.
 *
 * Storage-agnostic (in-memory or Postgres). `now` is injectable for deterministic tests.
 */
export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly registry: RegistryStore,
    private readonly sender: OtpSender,
    private readonly cfg: AuthConfig,
    private readonly now: () => number = () => Date.now(),
    /** When set (Twilio Verify), OTP send + check is delegated to the provider and
     *  the local generate/store/consume path is bypassed. App flow is unchanged. */
    private readonly verifier?: Verifier,
  ) {}

  /**
   * Customer self-signup with profile + password. Creates the party + login and
   * sends an OTP to VERIFY the phone (not a per-login code). After verifying once,
   * the user logs in with email/phone + password.
   */
  async registerCustomer(args: {
    phone: string;
    name?: string | null;
    country?: string | null;
    email?: string | null;
    password?: string | null;
  }): Promise<{ user: PublicUser }> {
    if (await this.store.getUserByPhone(args.phone)) {
      throw new AuthError(`phone ${args.phone} already registered`, 'CONFLICT');
    }
    if (args.email && (await this.store.getUserByEmail(args.email))) {
      throw new AuthError(`email ${args.email} already registered`, 'CONFLICT');
    }
    const passwordHash = args.password ? hashPassword(args.password) : null;
    const externalId = await this.createCustomerParty();
    const user = await this.store.createUser({
      role: 'customer',
      externalId,
      phone: args.phone,
      email: args.email ?? null,
      name: args.name ?? null,
      country: args.country ?? null,
      passwordHash,
    });
    await this.issueOtp(args.phone, 'signup'); // verify the phone
    return { user: toPublic(user) };
  }

  /** Password login by email OR phone. No OTP — the phone was verified at signup. */
  async loginWithPassword(args: { handle: string; password: string; device?: string }): Promise<AuthTokens> {
    const user = await this.resolveByHandle(args.handle);
    // Always run a verify (dummy when unknown) so timing doesn't leak account existence.
    const ok = verifyPassword(args.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AuthError('invalid email/phone or password', 'UNAUTHORIZED');
    if (user.status === 'blocked') throw new AuthError('account is blocked', 'FORBIDDEN');
    return this.startSession(user, args.device);
  }

  /** Start a password reset: send an OTP to the account's phone. Always reports
   *  success (never reveals whether the handle exists). */
  async requestPasswordReset(handle: string): Promise<{ sent: true }> {
    const user = await this.resolveByHandle(handle);
    if (user && user.status !== 'blocked') await this.issueOtp(user.phone, 'reset');
    return { sent: true };
  }

  /** Complete a reset: verify the phone OTP, set the new password, and log in. */
  async resetPassword(args: { phone: string; code: string; newPassword: string; device?: string }): Promise<AuthTokens> {
    const user = await this.store.getUserByPhone(args.phone);
    if (!user) throw new AuthError(`no account for ${args.phone}`, 'NOT_FOUND');
    if (user.status === 'blocked') throw new AuthError('account is blocked', 'FORBIDDEN');
    const ok = this.verifier
      ? await this.verifier.check(args.phone, args.code)
      : await this.store.consumeOtp(args.phone, sha256Hex(args.code), this.iso(this.now()));
    if (!ok) throw new AuthError('invalid or expired code', 'INVALID_OTP');
    await this.store.setPasswordHash(user.id, hashPassword(args.newPassword));
    if (!user.phoneVerified) await this.store.markPhoneVerified(user.id);
    return this.startSession(user, args.device);
  }

  /** Profile for /app/me (name/country/email/phone/verified). */
  async profile(userId: string): Promise<{ name: string | null; country: string | null; email: string | null; phone: string; phoneVerified: boolean } | null> {
    const u = await this.store.getUserById(userId);
    return u ? { name: u.name, country: u.country, email: u.email, phone: u.phone, phoneVerified: u.phoneVerified } : null;
  }

  /** Resolve a login handle: '@' -> email, else phone. */
  private resolveByHandle(handle: string): Promise<AppUser | null> {
    const h = handle.trim();
    return h.includes('@') ? this.store.getUserByEmail(h) : this.store.getUserByPhone(h);
  }

  /** Admin provisions an agent's app login (the agent must already exist). */
  async provisionAgentLogin(agentExternalId: string, phone: string): Promise<PublicUser> {
    const agent = await this.registry.getAgent(agentExternalId);
    if (!agent) throw new AuthError(`agent ${agentExternalId} not found`, 'NOT_FOUND');
    if (await this.store.getUserByPhone(phone)) {
      throw new AuthError(`phone ${phone} already registered`, 'CONFLICT');
    }
    const user = await this.store.createUser({ role: 'agent', externalId: agentExternalId, phone });
    return toPublic(user);
  }

  /** Request (or re-request) a login OTP for an existing user. Rate-limited per phone. */
  async requestOtp(phone: string): Promise<{ sent: true }> {
    const user = await this.store.getUserByPhone(phone);
    if (!user) throw new AuthError(`no account for ${phone}`, 'NOT_FOUND');
    if (user.status === 'blocked') throw new AuthError('account is blocked', 'FORBIDDEN');
    await this.issueOtp(phone, 'login');
    return { sent: true };
  }

  /** Verify an OTP and start a session (issue access + refresh tokens). */
  async verifyOtp(args: { phone: string; code: string; device?: string }): Promise<AuthTokens> {
    const user = await this.store.getUserByPhone(args.phone);
    if (!user) throw new AuthError(`no account for ${args.phone}`, 'NOT_FOUND');
    if (user.status === 'blocked') throw new AuthError('account is blocked', 'FORBIDDEN');
    const ok = this.verifier
      ? await this.verifier.check(args.phone, args.code)
      : await this.store.consumeOtp(args.phone, sha256Hex(args.code), this.iso(this.now()));
    if (!ok) throw new AuthError('invalid or expired code', 'INVALID_OTP');
    if (!user.phoneVerified) await this.store.markPhoneVerified(user.id);
    return this.startSession(user, args.device);
  }

  /** Rotate a refresh token: validate, revoke-by-rotation, issue a fresh pair. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.store.getSessionByRefreshHash(sha256Hex(refreshToken));
    const nowIso = this.iso(this.now());
    if (!session || session.revokedAt !== null || session.expiresAt <= nowIso) {
      throw new AuthError('invalid or expired refresh token', 'INVALID_REFRESH');
    }
    const user = await this.store.getUserById(session.userId);
    if (!user) throw new AuthError('account not found', 'INVALID_REFRESH');
    if (user.status === 'blocked') {
      await this.store.revokeSession(session.id, nowIso);
      throw new AuthError('account is blocked', 'FORBIDDEN');
    }
    const newToken = newRefreshToken();
    const rotated = await this.store.rotateSession(
      session.id,
      sha256Hex(refreshToken),
      sha256Hex(newToken),
      this.iso(this.now() + this.cfg.refreshTtlSec * 1000),
    );
    // Lost the race (the token was already rotated/reused) -> reject.
    if (!rotated) throw new AuthError('invalid or expired refresh token', 'INVALID_REFRESH');
    return {
      accessToken: this.accessFor(user),
      refreshToken: newToken,
      expiresIn: this.cfg.accessTtlSec,
      user: toPublic(user),
    };
  }

  /** Remote logout: revoke the session behind a refresh token (idempotent). */
  async logout(refreshToken: string): Promise<{ ok: true }> {
    const session = await this.store.getSessionByRefreshHash(sha256Hex(refreshToken));
    if (session) await this.store.revokeSession(session.id, this.iso(this.now()));
    return { ok: true };
  }

  /** Validate an access token (used by the /app/* auth boundary). */
  verifyAccess(token: string): JwtClaims | null {
    return verifyAccessToken(token, this.cfg.jwtSecret, this.now());
  }

  /** Resolve a login by phone (e.g. an agent looking up a customer to serve). */
  async findUserByPhone(phone: string): Promise<PublicUser | null> {
    const u = await this.store.getUserByPhone(phone);
    return u ? toPublic(u) : null;
  }

  // ---- internals -----------------------------------------------------------

  private async startSession(user: AppUser, device?: string): Promise<AuthTokens> {
    const refreshToken = newRefreshToken();
    await this.store.createSession({
      userId: user.id,
      refreshTokenHash: sha256Hex(refreshToken),
      device: device ?? null,
      expiresAt: this.iso(this.now() + this.cfg.refreshTtlSec * 1000),
    });
    return {
      accessToken: this.accessFor(user),
      refreshToken,
      expiresIn: this.cfg.accessTtlSec,
      user: toPublic(user),
    };
  }

  private accessFor(user: AppUser): string {
    return signAccessToken(
      { sub: user.id, role: user.role, ext: user.externalId },
      this.cfg.jwtSecret,
      this.cfg.accessTtlSec,
      this.now(),
    );
  }

  private async issueOtp(phone: string, purpose: string): Promise<void> {
    // Provider-managed path (Twilio Verify): it generates + sends the code and
    // enforces its own per-number rate limiting, so we don't store/send locally.
    if (this.verifier) {
      await this.verifier.start(phone, purpose);
      return;
    }
    const since = this.iso(this.now() - 3_600_000);
    if ((await this.store.countOtpsSince(phone, since)) >= this.cfg.otpMaxPerHour) {
      throw new AuthError('too many code requests; try again later', 'RATE_LIMITED');
    }
    const code = newOtpCode(this.cfg.otpLength);
    await this.store.saveOtp({
      phone,
      codeHash: sha256Hex(code),
      purpose,
      expiresAt: this.iso(this.now() + this.cfg.otpTtlSec * 1000),
    });
    await this.sender.send(phone, code, purpose);
  }

  /** Create a fresh customer party with a synthetic external id (no PII in the id). */
  private async createCustomerParty(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const externalId = `cust-${randomBytes(5).toString('hex')}`;
      try {
        await this.registry.createCustomer({ externalId });
        return externalId;
      } catch (err) {
        if (err instanceof RegistryError && err.code === 'CONFLICT') continue; // id clash, retry
        throw err;
      }
    }
    throw new AuthError('could not allocate a customer id', 'VALIDATION');
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString();
  }
}

function toPublic(u: AppUser): PublicUser {
  return { id: u.id, role: u.role, externalId: u.externalId, phone: u.phone };
}
