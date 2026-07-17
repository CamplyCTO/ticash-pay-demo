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
import { InMemoryScreeningStore } from '../screening/hit-store';
import { PgScreeningStore } from '../screening/pg-hit-store';
import { ScreeningStore } from '../screening/types';
import { AirtimeMarginStore, InMemoryAirtimeMarginStore } from '../airtime/margin-store';
import { PgAirtimeMarginStore } from '../airtime/pg-margin-store';
import { AuthStore } from '../auth/auth-store';
import { InMemoryAuthStore } from '../auth/in-memory-auth-store';
import { PgAuthStore } from '../auth/pg-auth-store';
import { InMemoryPushTokenStore, PgPushTokenStore, PushTokenStore } from '../push/push-token-store';
import { InMemoryP2PStore, P2PStore, PgP2PStore } from '../p2p/p2p-store';
import { InMemorySettingsStore, PgSettingsStore, SettingsStore } from '../settings/settings-store';
import { CashoutStore, InMemoryCashoutStore, PgCashoutStore } from '../cashout/cashout-store';

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

export function createScreeningStore(): ScreeningStore {
  return config.useInMemory ? new InMemoryScreeningStore() : new PgScreeningStore(getPool());
}

export function createAirtimeMarginStore(): AirtimeMarginStore {
  const def = config.dingconnect.defaultMarginBps;
  return config.useInMemory ? new InMemoryAirtimeMarginStore(def) : new PgAirtimeMarginStore(getPool(), def);
}

export function createAuthStore(): AuthStore {
  return config.useInMemory ? new InMemoryAuthStore() : new PgAuthStore(getPool());
}

export function createPushTokenStore(): PushTokenStore {
  return config.useInMemory ? new InMemoryPushTokenStore() : new PgPushTokenStore(getPool());
}

export function createP2PStore(): P2PStore {
  return config.useInMemory ? new InMemoryP2PStore() : new PgP2PStore(getPool());
}

export function createSettingsStore(): SettingsStore {
  return config.useInMemory ? new InMemorySettingsStore() : new PgSettingsStore(getPool());
}

export function createCashoutStore(): CashoutStore {
  return config.useInMemory ? new InMemoryCashoutStore() : new PgCashoutStore(getPool());
}
