import { config } from '../config';
import { getPool } from '../db/pool';
import { InMemoryLedgerStore } from './in-memory-store';
import { PgLedgerStore } from './pg-store';
import { LedgerStore } from './store';
import { InMemoryRegistryStore } from '../registry/in-memory-registry';
import { PgRegistryStore } from '../registry/pg-registry';
import { RegistryStore } from '../registry/store';

export function createStore(): LedgerStore {
  return config.useInMemory ? new InMemoryLedgerStore() : new PgLedgerStore(getPool());
}

export function createRegistry(): RegistryStore {
  return config.useInMemory ? new InMemoryRegistryStore() : new PgRegistryStore(getPool());
}
