import { Pool } from 'pg';
import { HitRecord, ScreeningStore } from './types';

/** Postgres-backed sanctions-hit audit log (table `sanctions_hits`, migration 0007). */
export class PgScreeningStore implements ScreeningStore {
  constructor(private readonly pool: Pool) {}

  async record(hit: Omit<HitRecord, 'createdAt'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO sanctions_hits (subject, context, list, matched_name, score) VALUES ($1,$2,$3,$4,$5)`,
      [hit.subject, hit.context, hit.list, hit.matchedName, hit.score],
    );
  }

  async list(limit = 100): Promise<HitRecord[]> {
    const res = await this.pool.query(
      `SELECT subject, context, list, matched_name, score, created_at
         FROM sanctions_hits ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({
      subject: r.subject,
      context: r.context,
      list: r.list,
      matchedName: r.matched_name,
      score: Number(r.score),
      createdAt: r.created_at.toISOString(),
    }));
  }
}
