import type { Currency } from './currency';

export type AppRole = 'customer' | 'agent';

export interface PublicUser {
  id: string;
  role: AppRole;
  externalId: string;
  phone: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export interface WalletBalance {
  currency: Currency;
  balanceMinor: string;
}

export interface MeCustomer {
  user: { id: string; role: 'customer'; externalId: string };
  kyc: { level: number; status: string } | null;
  wallets: WalletBalance[];
}

export interface MeAgent {
  user: { id: string; role: 'agent'; externalId: string };
  agent: { commissionBps: number } | null;
  float: WalletBalance[];
}

export type Me = MeCustomer | MeAgent;

export function isCustomerMe(me: Me): me is MeCustomer {
  return me.user.role === 'customer';
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_OTP'
  | 'INVALID_REFRESH'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NETWORK'
  | 'UNKNOWN';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
