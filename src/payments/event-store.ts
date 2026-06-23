import { Pool } from 'pg';

/**
 * Webhook idempotency + audit. We record an inbound provider event only AFTER it
 * is handled successfully; a replay is detected via `seen` and skipped. (The
 * ledger idempotency key is the inner guard; this is the outer one + an audit
 * trail.) Recording after success means a failed handler is safely retried.
 */
export interface ProviderEventStore {
  seen(provider: string, eventUid: string): Promise<boolean>;
  record(provider: string, eventUid: string, kind: string, payload: unknown): Promise<void>;
}

export class InMemoryProviderEventStore implements ProviderEventStore {
  private readonly seenKeys = new Set<string>();
  private key(p: string, e: string) {
    return `${p}:${e}`;
  }
  async seen(provider: string, eventUid: string): Promise<boolean> {
    return this.seenKeys.has(this.key(provider, eventUid));
  }
  async record(provider: string, eventUid: string): Promise<void> {
    this.seenKeys.add(this.key(provider, eventUid));
  }
}

export class PgProviderEventStore implements ProviderEventStore {
  constructor(private readonly pool: Pool) {}
  async seen(provider: string, eventUid: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM provider_events WHERE provider = $1 AND event_uid = $2`,
      [provider, eventUid],
    );
    return (res.rowCount ?? 0) > 0;
  }
  async record(provider: string, eventUid: string, kind: string, payload: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO provider_events (provider, event_uid, kind, payload)
       VALUES ($1,$2,$3,$4) ON CONFLICT (provider, event_uid) DO NOTHING`,
      [provider, eventUid, kind, payload ?? {}],
    );
  }
}
