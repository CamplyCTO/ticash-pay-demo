import { RegistryError, RegistryStore } from './store';
import { Agent, CreateAgentInput, CreateCustomerInput, Customer, KycStatus, PartyStatus } from './types';

export class InMemoryRegistryStore implements RegistryStore {
  private readonly customers = new Map<string, Customer>();
  private readonly agents = new Map<string, Agent>();
  private seq = 0;

  constructor(private readonly clock: () => string = () => new Date(Date.UTC(2026, 0, 1, 0, 0, this.seq++)).toISOString()) {}

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    if (this.customers.has(input.externalId)) {
      throw new RegistryError(`customer ${input.externalId} already exists`, 'CONFLICT');
    }
    const customer: Customer = {
      externalId: input.externalId,
      kycLevel: input.kycLevel ?? 0,
      kycStatus: input.kycStatus ?? 'pending',
      status: 'active',
      createdAt: this.clock(),
    };
    this.customers.set(customer.externalId, customer);
    return customer;
  }

  async getCustomer(externalId: string): Promise<Customer | null> {
    return this.customers.get(externalId) ?? null;
  }

  async listCustomers(): Promise<Customer[]> {
    return [...this.customers.values()].sort((a, b) => a.externalId.localeCompare(b.externalId));
  }

  async setCustomerKyc(externalId: string, level: number, status: KycStatus): Promise<Customer> {
    const c = this.customers.get(externalId);
    if (!c) throw new RegistryError(`customer ${externalId} not found`, 'NOT_FOUND');
    const updated: Customer = { ...c, kycLevel: level, kycStatus: status };
    this.customers.set(externalId, updated);
    return updated;
  }

  async setCustomerStatus(externalId: string, status: PartyStatus): Promise<Customer> {
    const c = this.customers.get(externalId);
    if (!c) throw new RegistryError(`customer ${externalId} not found`, 'NOT_FOUND');
    const updated: Customer = { ...c, status };
    this.customers.set(externalId, updated);
    return updated;
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    if (this.agents.has(input.externalId)) {
      throw new RegistryError(`agent ${input.externalId} already exists`, 'CONFLICT');
    }
    const agent: Agent = {
      externalId: input.externalId,
      floatLimitMinor: input.floatLimitMinor ?? 0n,
      commissionBps: input.commissionBps ?? 0,
      status: 'active',
      createdAt: this.clock(),
    };
    this.agents.set(agent.externalId, agent);
    return agent;
  }

  async getAgent(externalId: string): Promise<Agent | null> {
    return this.agents.get(externalId) ?? null;
  }

  async setAgentStatus(externalId: string, status: PartyStatus): Promise<Agent> {
    const a = this.agents.get(externalId);
    if (!a) throw new RegistryError(`agent ${externalId} not found`, 'NOT_FOUND');
    const updated: Agent = { ...a, status };
    this.agents.set(externalId, updated);
    return updated;
  }

  async setAgentCommission(externalId: string, commissionBps: number): Promise<Agent> {
    const a = this.agents.get(externalId);
    if (!a) throw new RegistryError(`agent ${externalId} not found`, 'NOT_FOUND');
    const updated: Agent = { ...a, commissionBps };
    this.agents.set(externalId, updated);
    return updated;
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()].sort((a, b) => a.externalId.localeCompare(b.externalId));
  }
}
