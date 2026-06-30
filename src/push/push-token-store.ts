import { Pool } from 'pg';
import { RegisterTokenInput } from './types';

/**
 * Device-token registry for push. `upsert` is keyed on the Expo token so a device
 * re-registering (e.g. after re-login under a different user) reassigns + re-enables
 * it; `disable` is the opt-out (kept for audit). Adapters: in-memory + Postgres.
 */
export interface PushTokenStore {
  upsert(input: RegisterTokenInput): Promise<void>;
  disable(expoToken: string): Promise<void>;
  /** Active (not opted-out) tokens for a user. */
  tokensForUser(userId: string): Promise<string[]>;
}

interface Row {
  userId: string;
  platform: string | null;
  disabled: boolean;
}

export class InMemoryPushTokenStore implements PushTokenStore {
  private readonly byToken = new Map<string, Row>();

  async upsert(input: RegisterTokenInput): Promise<void> {
    this.byToken.set(input.expoToken, { userId: input.userId, platform: input.platform ?? null, disabled: false });
  }
  async disable(expoToken: string): Promise<void> {
    const r = this.byToken.get(expoToken);
    if (r) this.byToken.set(expoToken, { ...r, disabled: true });
  }
  async tokensForUser(userId: string): Promise<string[]> {
    const out: string[] = [];
    for (const [token, r] of this.byToken) if (r.userId === userId && !r.disabled) out.push(token);
    return out;
  }
}

export class PgPushTokenStore implements PushTokenStore {
  constructor(private readonly pool: Pool) {}

  async upsert(input: RegisterTokenInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_tokens (user_id, expo_token, platform)
       VALUES ($1,$2,$3)
       ON CONFLICT (expo_token)
       DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, disabled = false, updated_at = now()`,
      [input.userId, input.expoToken, input.platform ?? null],
    );
  }
  async disable(expoToken: string): Promise<void> {
    await this.pool.query(`UPDATE push_tokens SET disabled = true, updated_at = now() WHERE expo_token = $1`, [expoToken]);
  }
  async tokensForUser(userId: string): Promise<string[]> {
    const res = await this.pool.query(`SELECT expo_token FROM push_tokens WHERE user_id = $1 AND disabled = false`, [userId]);
    return res.rows.map((r) => r.expo_token as string);
  }
}
