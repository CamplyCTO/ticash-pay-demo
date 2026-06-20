import { toMinor } from '../money/money';
import { LedgerService } from '../ledger/service';
import { RegistryStore } from '../registry/store';

/**
 * Idempotent demo seed — the "Jean → Marie" story. Safe to run on every boot:
 * ledger ops dedupe on their idempotency key, and registry creates ignore
 * "already exists" so a restart (or a Postgres-backed redeploy) never doubles data.
 */
export async function seedDemo(deps: { ledger: LedgerService; registry: RegistryStore }): Promise<void> {
  const { ledger, registry } = deps;
  const brl = (v: string) => toMinor(v, 'BRL');
  const safe = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch {
      /* ignore conflicts on re-seed */
    }
  };

  await safe(registry.createCustomer({ externalId: 'jean' }));
  await safe(registry.createCustomer({ externalId: 'souza' }));
  await safe(registry.setCustomerKyc('jean', 2, 'approved'));
  await safe(registry.setCustomerKyc('souza', 1, 'review'));
  await safe(registry.createAgent({ externalId: 'pedro', floatLimitMinor: brl('15000.00'), commissionBps: 75 }));
  await safe(registry.createAgent({ externalId: 'loja-sp', floatLimitMinor: brl('10000.00'), commissionBps: 50 }));

  await safe(ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: brl('1240.00'), idempotencyKey: 'seed-fund', externalRef: 'pix-001' }));
  await safe(ledger.floatTopup({ agentId: 'pedro', currency: 'BRL', amountMinor: brl('8450.00'), idempotencyKey: 'seed-float' }));
  await safe(ledger.cashIn({ agentId: 'pedro', customerId: 'souza', currency: 'BRL', amountMinor: brl('250.00'), idempotencyKey: 'seed-ci' }));
  await safe(
    ledger.initiateTransfer({
      senderId: 'jean',
      recipientRef: 'Marie L. / MonCash',
      fromCurrency: 'BRL',
      toCurrency: 'HTG',
      sendMinor: brl('500.00'),
      feeMinor: brl('12.50'),
      rate: '24.36',
      idempotencyKey: 'seed-xfer',
    }),
  );
}
