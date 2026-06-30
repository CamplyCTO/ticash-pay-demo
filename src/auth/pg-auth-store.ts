import { Pool } from 'pg';
import { AuthError, AuthStore } from './auth-store';
import { AppUser, CreateAppUserInput, CreateSessionInput, SaveOtpInput, Session } from './types';

/** Postgres-backed AuthStore over app_users / otp_codes / sessions (migration 0010). */
export class PgAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async createUser(input: CreateAppUserInput): Promise<AppUser> {
    try {
      const res = await this.pool.query(
        `INSERT INTO app_users (role, external_id, phone, email)
         VALUES ($1,$2,$3,$4)
         RETURNING id, role, external_id, phone, email, status, created_at`,
        [input.role, input.externalId, input.phone, input.email ?? null],
      );
      return mapUser(res.rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new AuthError(`phone ${input.phone} already registered`, 'CONFLICT');
      }
      throw err;
    }
  }

  async getUserById(id: string): Promise<AppUser | null> {
    const res = await this.pool.query(
      `SELECT id, role, external_id, phone, email, status, created_at FROM app_users WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? mapUser(res.rows[0]) : null;
  }

  async getUserByPhone(phone: string): Promise<AppUser | null> {
    const res = await this.pool.query(
      `SELECT id, role, external_id, phone, email, status, created_at FROM app_users WHERE phone = $1`,
      [phone],
    );
    return res.rows[0] ? mapUser(res.rows[0]) : null;
  }

  async findUsersByExternalId(externalId: string): Promise<AppUser[]> {
    const res = await this.pool.query(
      `SELECT id, role, external_id, phone, email, status, created_at FROM app_users WHERE external_id = $1`,
      [externalId],
    );
    return res.rows.map(mapUser);
  }

  async saveOtp(input: SaveOtpInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at) VALUES ($1,$2,$3,$4)`,
      [input.phone, input.codeHash, input.purpose, input.expiresAt],
    );
  }

  async consumeOtp(phone: string, codeHash: string, nowIso: string): Promise<boolean> {
    // Single atomic statement: claim the newest valid code by setting consumed_at.
    // The outer `consumed_at IS NULL` guard re-checks the row AFTER it is locked, so
    // two concurrent verifies of the same code can never both succeed (one-time use).
    const res = await this.pool.query(
      `UPDATE otp_codes SET consumed_at = now()
         WHERE id = (
           SELECT id FROM otp_codes
            WHERE phone = $1 AND code_hash = $2 AND consumed_at IS NULL AND expires_at > $3
            ORDER BY id DESC LIMIT 1
         )
         AND consumed_at IS NULL
       RETURNING id`,
      [phone, codeHash, nowIso],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async countOtpsSince(phone: string, sinceIso: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at >= $2`,
      [phone, sinceIso],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const res = await this.pool.query(
      `INSERT INTO sessions (user_id, refresh_token_hash, device, expires_at)
       VALUES ($1,$2,$3,$4)
       RETURNING id, user_id, refresh_token_hash, device, expires_at, revoked_at, created_at`,
      [input.userId, input.refreshTokenHash, input.device ?? null, input.expiresAt],
    );
    return mapSession(res.rows[0]);
  }

  async getSessionByRefreshHash(hash: string): Promise<Session | null> {
    const res = await this.pool.query(
      `SELECT id, user_id, refresh_token_hash, device, expires_at, revoked_at, created_at
         FROM sessions WHERE refresh_token_hash = $1`,
      [hash],
    );
    return res.rows[0] ? mapSession(res.rows[0]) : null;
  }

  async rotateSession(id: string, oldHash: string, newHash: string, newExpiresAt: string): Promise<boolean> {
    // Reuse-safe: rotate only if the presented (old) hash still matches and the
    // session is live. A replayed/stale refresh token matches no live row -> false.
    const res = await this.pool.query(
      `UPDATE sessions SET refresh_token_hash = $3, expires_at = $4
         WHERE id = $1 AND refresh_token_hash = $2 AND revoked_at IS NULL
       RETURNING id`,
      [id, oldHash, newHash, newExpiresAt],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async revokeSession(id: string, revokedAtIso: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`,
      [id, revokedAtIso],
    );
  }
}

function mapUser(r: any): AppUser {
  return {
    id: r.id,
    role: r.role,
    externalId: r.external_id,
    phone: r.phone,
    email: r.email ?? null,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

function mapSession(r: any): Session {
  return {
    id: r.id,
    userId: r.user_id,
    refreshTokenHash: r.refresh_token_hash,
    device: r.device ?? null,
    expiresAt: r.expires_at.toISOString(),
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}
