import { config } from '../config';
import { getPool } from '../db/pool';
import { InMemoryLedgerStore } from './in-memory-store';
import { PgLedgerStore } from './pg-store';
import { LedgerStore } from './store';
import { InMemoryRegistryStore } from '../registry/in-memory-registry';
import { PgRegistryStore } from '../registry/pg-registry';
import { RegistryStore } from '../registry/store';
import { InMemoryPaymentIntentStore, PaymentIntentStore } from '../payments/intent-store';
import { PgPaymentIntentStore } from '../payments/pg-intent-store';
import {
  InMemoryProviderEventStore,
  PgProviderEventStore,
  ProviderEventStore,
} from '../payments/event-store';
import { InMemoryPayoutStore, PayoutStore } from '../payouts/payout-store';
import { PgPayoutStore } from '../payouts/pg-payout-store';
import { InMemoryTransferStore, TransferStore } from '../transfers/transfer-store';
import { PgTransferStore } from '../transfers/pg-transfer-store';
import { InMemoryRateStore } from '../fx/rate-store';
import { PgRateStore } from '../fx/pg-rate-store';
import { RateStore } from '../fx/types';

export function createStore(): LedgerStore {
  return config.useInMemory ? new InMemoryLedgerStore() : new PgLedgerStore(getPool());
}

export function createRegistry(): RegistryStore {
  return config.useInMemory ? new InMemoryRegistryStore() : new PgRegistryStore(getPool());
}

export function createPaymentIntentStore(): PaymentIntentStore {
  return config.useInMemory ? new InMemoryPaymentIntentStore() : new PgPaymentIntentStore(getPool());
}

export function createProviderEventStore(): ProviderEventStore {
  return config.useInMemory ? new InMemoryProviderEventStore() : new PgProviderEventStore(getPool());
}

export function createPayoutStore(): PayoutStore {
  return config.useInMemory ? new InMemoryPayoutStore() : new PgPayoutStore(getPool());
}

export function createTransferStore(): TransferStore {
  return config.useInMemory ? new InMemoryTransferStore() : new PgTransferStore(getPool());
}

export function createRateStore(): RateStore {
  return config.useInMemory
    ? new InMemoryRateStore({ marginBps: config.fx.defaultMarginBps, platformFeeBps: config.fx.defaultPlatformFeeBps, providerFeeBps: config.fx.defaultProviderFeeBps })
    : new PgRateStore(getPool());
}
