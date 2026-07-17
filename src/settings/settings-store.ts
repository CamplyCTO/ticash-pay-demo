import { Pool } from 'pg';

/** Tiny key→value store for runtime-editable settings (e.g. the P2P commission).
 *  Persisted so an admin change survives restarts/redeploys. */
export interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export class InMemorySettingsStore implements SettingsStore {
  private readonly m = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.m.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.m.set(key, value);
  }
}

export class PgSettingsStore implements SettingsStore {
  constructor(private readonly pool: Pool) {}
  async get(key: string): Promise<string | null> {
    const r = await this.pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    return r.rows[0]?.value ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
      [key, value],
    );
  }
}
