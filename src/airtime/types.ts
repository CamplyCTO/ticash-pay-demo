import { HttpClient } from '../payments/types';

/**
 * Mobile airtime recharge port. One interface, swappable provider: DingConnect now.
 * The customer's wallet pays `sendValue` (in the account currency) and the recipient
 * receives `receiveValue` airtime on their phone.
 */

export interface AirtimeProduct {
  skuCode: string;
  providerCode: string;
  sendValue: number; // cost in the account currency
  sendCurrency: string;
  receiveValue: number; // airtime delivered
  receiveCurrency: string;
}

export interface AirtimeSendRequest {
  accountNumber: string; // recipient phone (msisdn)
  skuCode: string;
  sendValue: number;
  sendCurrency: string;
  distributorRef: string; // our idempotency reference
}

export interface AirtimeSendResult {
  providerRef: string;
  raw: unknown;
}

export interface AirtimePort {
  readonly name: string;
  balance(): Promise<{ amount: number; currency: string }>;
  products(countryIso: string): Promise<AirtimeProduct[]>;
  send(req: AirtimeSendRequest): Promise<AirtimeSendResult>;
}

export type { HttpClient };
