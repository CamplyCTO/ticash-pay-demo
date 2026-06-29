import { randomUUID } from 'node:crypto';
import { AuthError, AuthStore } from './auth-store';
import { AppUser, CreateAppUserInput, CreateSessionInput, SaveOtpInput, Session } from './types';

interface OtpRow {
  phone: string;
  codeHash: string;
  purpose: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

/**
 * In-memory AuthStore. Mirrors the Postgres adapter's behaviour; used for unit
 * tests, the demo, and as the executable spec the SQL adapter matches.
 */
export class InMemoryAuthStore implements AuthStore {
  private readonly users = new Map<string, AppUser>(); // id -> user
  private readonly byPhone = new Map<string, string>(); // phone -> id
  private readonly otps: OtpRow[] = [];
  private readonly sessions = new Map<string, Session>();

  // Default clock is REAL time, mirroring Postgres `now()` for created_at. Auth
  // compares OTP created_at against (service now - 1h) for rate limiting, so a
  // frozen clock here (unlike the registry/ledger stores) would break that
  // comparison whenever the service runs on real time. Injectable for tests.
  constructor(private readonly clock: () => string = () => new Date().toISOString()) {}

  async createUser(input: CreateAppUserInput): Promise<AppUser> {
    if (this.byPhone.has(input.phone)) {
      throw new AuthError(`phone ${input.phone} already registered`, 'CONFLICT');
    }
    const user: AppUser = {
      id: randomUUID(),
      role: input.role,
      externalId: input.externalId,
      phone: input.phone,
      email: input.email ?? null,
      status: 'active',
      createdAt: this.clock(),
    };
    this.users.set(user.id, user);
    this.byPhone.set(user.phone, user.id);
    return user;
  }

  async getUserById(id: string): Promise<AppUser | null> {
    return this.users.get(id) ?? null;
  }

  async getUserByPhone(phone: string): Promise<AppUser | null> {
    const id = this.byPhone.get(phone);
    return id ? this.users.get(id) ?? null : null;
  }

  async saveOtp(input: SaveOtpInput): Promise<void> {
    this.otps.push({ ...input, consumedAt: null, createdAt: this.clock() });
  }

  async consumeOtp(phone: string, codeHash: string, nowIso: string): Promise<boolean> {
    // Newest matching, unconsumed, unexpired code wins (mirrors the PG ORDER BY id DESC).
    for (let i = this.otps.length - 1; i >= 0; i--) {
      const o = this.otps[i] as OtpRow;
      if (o.phone === phone && o.codeHash === codeHash && o.consumedAt === null && o.expiresAt > nowIso) {
        o.consumedAt = nowIso;
        return true;
      }
    }
    return false;
  }

  async countOtpsSince(phone: string, sinceIso: string): Promise<number> {
    return this.otps.filter((o) => o.phone === phone && o.createdAt >= sinceIso).length;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      device: input.device ?? null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: this.clock(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSessionByRefreshHash(hash: string): Promise<Session | null> {
    for (const s of this.sessions.values()) {
      if (s.refreshTokenHash === hash) return s;
    }
    return null;
  }

  async rotateSession(id: string, oldHash: string, newHash: string, newExpiresAt: string): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s || s.revokedAt !== null || s.refreshTokenHash !== oldHash) return false;
    this.sessions.set(id, { ...s, refreshTokenHash: newHash, expiresAt: newExpiresAt });
    return true;
  }

  async revokeSession(id: string, revokedAtIso: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s && s.revokedAt === null) this.sessions.set(id, { ...s, revokedAt: revokedAtIso });
  }
}
