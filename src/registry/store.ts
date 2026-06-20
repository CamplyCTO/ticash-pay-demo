import { Agent, CreateAgentInput, CreateCustomerInput, Customer, KycStatus } from './types';

export class RegistryError extends Error {
  constructor(message: string, readonly code: 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION' = 'VALIDATION') {
    super(message);
    this.name = 'RegistryError';
  }
}

/** Party registry persistence port. Adapters: in-memory (tests/demo) and Postgres. */
export interface RegistryStore {
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  getCustomer(externalId: string): Promise<Customer | null>;
  listCustomers(): Promise<Customer[]>;
  setCustomerKyc(externalId: string, level: number, status: KycStatus): Promise<Customer>;

  createAgent(input: CreateAgentInput): Promise<Agent>;
  getAgent(externalId: string): Promise<Agent | null>;
  listAgents(): Promise<Agent[]>;
}
