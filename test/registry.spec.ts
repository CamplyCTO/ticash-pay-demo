import { describe, expect, it } from 'vitest';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';

describe('registry (in-memory)', () => {
  it('creates and lists customers', async () => {
    const r = new InMemoryRegistryStore();
    await r.createCustomer({ externalId: 'jean' });
    await r.createCustomer({ externalId: 'marie', kycStatus: 'approved', kycLevel: 2 });
    const list = await r.listCustomers();
    expect(list.map((c) => c.externalId)).toEqual(['jean', 'marie']);
    expect(list[1]).toMatchObject({ kycStatus: 'approved', kycLevel: 2 });
  });

  it('rejects duplicate customer', async () => {
    const r = new InMemoryRegistryStore();
    await r.createCustomer({ externalId: 'x' });
    await expect(r.createCustomer({ externalId: 'x' })).rejects.toThrow(/already exists/);
  });

  it('updates KYC and rejects unknown', async () => {
    const r = new InMemoryRegistryStore();
    await r.createCustomer({ externalId: 'jean' });
    const updated = await r.setCustomerKyc('jean', 2, 'approved');
    expect(updated).toMatchObject({ kycLevel: 2, kycStatus: 'approved' });
    await expect(r.setCustomerKyc('nobody', 1, 'approved')).rejects.toThrow(/not found/);
  });

  it('creates agents with float limit and commission', async () => {
    const r = new InMemoryRegistryStore();
    await r.createAgent({ externalId: 'pedro', floatLimitMinor: 1500000n, commissionBps: 75 });
    const a = await r.getAgent('pedro');
    expect(a).toMatchObject({ floatLimitMinor: 1500000n, commissionBps: 75 });
  });

  it('adjusts an agent commission and rejects an unknown agent', async () => {
    const r = new InMemoryRegistryStore();
    await r.createAgent({ externalId: 'pedro', commissionBps: 50 });
    const updated = await r.setAgentCommission('pedro', 125);
    expect(updated.commissionBps).toBe(125);
    expect((await r.getAgent('pedro'))?.commissionBps).toBe(125);
    await expect(r.setAgentCommission('ghost', 100)).rejects.toThrow(/not found/);
  });
});
