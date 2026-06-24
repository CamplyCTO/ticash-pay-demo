/** Party records (identity/profile). Live OUTSIDE the ledger — no money here. */

export type KycStatus = 'pending' | 'approved' | 'rejected' | 'review';
/** Whether a party may transact. `blocked` parties are rejected by money operations. */
export type PartyStatus = 'active' | 'blocked';

export interface Customer {
  externalId: string; // app-facing id; also used as ledger account ownerId
  kycLevel: number; // 0=none, 1=basic, 2=full
  kycStatus: KycStatus;
  status: PartyStatus;
  createdAt: string;
}

export interface Agent {
  externalId: string;
  floatLimitMinor: bigint; // BRL minor units (MVP: single-currency float limit)
  commissionBps: number; // basis points
  status: PartyStatus;
  createdAt: string;
}

export interface CreateCustomerInput {
  externalId: string;
  kycLevel?: number;
  kycStatus?: KycStatus;
}

export interface CreateAgentInput {
  externalId: string;
  floatLimitMinor?: bigint;
  commissionBps?: number;
}
