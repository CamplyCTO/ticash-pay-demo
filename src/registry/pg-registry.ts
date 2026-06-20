import { Pool } from 'pg';
import { RegistryError, RegistryStore } from './store';
import { Agent, CreateAgentInput, CreateCustomerInput, Customer, KycStatus } from './types';

/** Postgres-backed party registry over the `customers` / `agents` tables. */
export class PgRegistryStore implements RegistryStore {
  constructor(private readonly pool: Pool) {}

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    try {
      const res = await this.pool.query(
        `INSERT INTO customers (external_id, kyc_level, kyc_status)
         VALUES ($1,$2,$3)
         RETURNING external_id, kyc_level, kyc_status, status, created_at`,
        [input.externalId, input.kycLevel ?? 0, input.kycStatus ?? 'pending'],
      );
      return mapCustomer(res.rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new RegistryError(`customer ${input.externalId} already exists`, 'CONFLICT');
      }
      throw err;
    }
  }

  async getCustomer(externalId: string): Promise<Customer | null> {
    const res = await this.pool.query(
      `SELECT external_id, kyc_level, kyc_status, status, created_at FROM customers WHERE external_id = $1`,
      [externalId],
    );
    return res.rows[0] ? mapCustomer(res.rows[0]) : null;
  }

  async listCustomers(): Promise<Customer[]> {
    const res = await this.pool.query(
      `SELECT external_id, kyc_level, kyc_status, status, created_at FROM customers ORDER BY external_id`,
    );
    return res.rows.map(mapCustomer);
  }

  async setCustomerKyc(externalId: string, level: number, status: KycStatus): Promise<Customer> {
    const res = await this.pool.query(
      `UPDATE customers SET kyc_level = $2, kyc_status = $3 WHERE external_id = $1
       RETURNING external_id, kyc_level, kyc_status, status, created_at`,
      [externalId, level, status],
    );
    if (!res.rows[0]) throw new RegistryError(`customer ${externalId} not found`, 'NOT_FOUND');
    return mapCustomer(res.rows[0]);
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    try {
      const res = await this.pool.query(
        `INSERT INTO agents (external_id, float_limit_minor, commission_bps)
         VALUES ($1,$2,$3)
         RETURNING external_id, float_limit_minor, commission_bps, status, created_at`,
        [input.externalId, (input.floatLimitMinor ?? 0n).toString(), input.commissionBps ?? 0],
      );
      return mapAgent(res.rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new RegistryError(`agent ${input.externalId} already exists`, 'CONFLICT');
      }
      throw err;
    }
  }

  async getAgent(externalId: string): Promise<Agent | null> {
    const res = await this.pool.query(
      `SELECT external_id, float_limit_minor, commission_bps, status, created_at FROM agents WHERE external_id = $1`,
      [externalId],
    );
    return res.rows[0] ? mapAgent(res.rows[0]) : null;
  }

  async listAgents(): Promise<Agent[]> {
    const res = await this.pool.query(
      `SELECT external_id, float_limit_minor, commission_bps, status, created_at FROM agents ORDER BY external_id`,
    );
    return res.rows.map(mapAgent);
  }
}

function mapCustomer(r: any): Customer {
  return {
    externalId: r.external_id,
    kycLevel: Number(r.kyc_level),
    kycStatus: r.kyc_status,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

function mapAgent(r: any): Agent {
  return {
    externalId: r.external_id,
    floatLimitMinor: BigInt(r.float_limit_minor),
    commissionBps: Number(r.commission_bps),
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}
