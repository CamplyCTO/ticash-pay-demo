/** End-user auth domain (mobile apps). Identity only — no money lives here. */

export type AppRole = 'customer' | 'agent';
/** Whether a login may be used. `blocked` users cannot verify OTP or refresh. */
export type AppUserStatus = 'active' | 'blocked';

export interface AppUser {
  id: string; // uuid; the JWT subject
  role: AppRole;
  externalId: string; // links to customers/agents.external_id (the ledger ownerId)
  phone: string; // login handle (E.164)
  email: string | null; // alternate login handle
  name: string | null;
  country: string | null; // ISO-3166 alpha-2 (BR/HT/US/MX/DO) — sets the home currency
  passwordHash: string | null; // scrypt; null until a password is set
  phoneVerified: boolean; // true once the signup OTP is confirmed
  status: AppUserStatus;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  device: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateAppUserInput {
  role: AppRole;
  externalId: string;
  phone: string;
  email?: string | null;
  name?: string | null;
  country?: string | null;
  passwordHash?: string | null;
}

export interface SaveOtpInput {
  phone: string;
  codeHash: string;
  purpose: string;
  expiresAt: string;
}

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  device?: string | null;
  expiresAt: string;
}
