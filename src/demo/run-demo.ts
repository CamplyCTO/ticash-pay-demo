/**
 * Runnable end-to-end demo of the Phase 1 ledger — the "Jean -> Marie" story
 * from the proposal mockup, on the in-memory store. No database required:
 *   npm run demo
 */
import { InMemoryLedgerStore } from '../ledger/in-memory-store';
import { LedgerService } from '../ledger/service';
import { agentFloat, customerWallet, systemAccount } from '../ledger/operations';
import { Currency } from '../money/currency';
import { fromMinor, toMinor } from '../money/money';

async function main(): Promise<void> {
  const store = new InMemoryLedgerStore();
  const svc = new LedgerService(store);
  const brl = (v: string) => toMinor(v, 'BRL');

  line('SETUP');
  await svc.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: brl('1240.00'), idempotencyKey: 'd-fund-jean', externalRef: 'pix-e2e-001' });
  log('Jean funds wallet via PIX', '+R$ 1.240,00');
  await svc.floatTopup({ agentId: 'pedro', currency: 'BRL', amountMinor: brl('8450.00'), idempotencyKey: 'd-ft-pedro', externalRef: 'pix-e2e-002' });
  log("Agent Pedro tops up float via PIX", '+R$ 8.450,00');

  line('AGENT OPERATIONS (cash in / cash out)');
  await svc.cashIn({ agentId: 'pedro', customerId: 'souza', currency: 'BRL', amountMinor: brl('250.00'), idempotencyKey: 'd-ci-souza' });
  log('Cash in · customer Souza', '+R$ 250,00');
  await svc.fundWallet({ customerId: 'marie_br', currency: 'BRL', amountMinor: brl('180.00'), idempotencyKey: 'd-fund-marie' });
  await svc.cashOut({ agentId: 'pedro', customerId: 'marie_br', currency: 'BRL', amountMinor: brl('180.00'), idempotencyKey: 'd-co-marie' });
  log('Cash out · customer Marie', '-R$ 180,00');

  line('INTERNATIONAL TRANSFER · Brazil -> Haiti (Jean -> Marie via MonCash)');
  const xfer = await svc.initiateTransfer({
    senderId: 'jean',
    recipientRef: 'Marie L. / MonCash',
    fromCurrency: 'BRL',
    toCurrency: 'HTG',
    sendMinor: brl('500.00'),
    feeMinor: brl('12.50'),
    rate: '24.36',
    idempotencyKey: 'd-xfer-jean-marie',
  });
  log('Jean sends', `R$ ${fromMinor(xfer.quote.sendMinor, 'BRL')} (+ fee R$ ${fromMinor(xfer.quote.feeMinor, 'BRL')})`);
  log('FX rate BRL->HTG', xfer.quote.rate);
  log('Marie receives', `${fromMinor(xfer.quote.receiveMinor, 'HTG')} HTG  (parked in payout_suspense)`);

  log('Confirming MonCash payout...', '');
  await svc.settlePayout({ currency: 'HTG', amountMinor: xfer.quote.receiveMinor, correlationId: xfer.correlationId, externalRef: 'moncash-tx-77', idempotencyKey: 'd-payout-marie' });
  log('Payout settled', 'payout_suspense -> 0');

  line('IDEMPOTENCY CHECK (replay the transfer debit)');
  const before = await svc.getBalance(customerWallet('jean', 'BRL'));
  await svc.initiateTransfer({
    senderId: 'jean', recipientRef: 'Marie L. / MonCash', fromCurrency: 'BRL', toCurrency: 'HTG',
    sendMinor: brl('500.00'), feeMinor: brl('12.50'), rate: '24.36', idempotencyKey: 'd-xfer-jean-marie',
  });
  const after = await svc.getBalance(customerWallet('jean', 'BRL'));
  log('Jean balance unchanged on replay', `${fromMinor(before, 'BRL')} == ${fromMinor(after, 'BRL')} -> ${before === after ? 'OK' : 'FAIL'}`);

  line('BALANCES (the admin panel view)');
  for (const b of await svc.listBalances()) {
    console.log(`  ${b.accountKey.padEnd(38)} ${fromMinor(b.balanceMinor, b.currency).padStart(14)} ${b.currency}`);
  }

  line('LEDGER FEED (append-only, most recent first)');
  for (const r of await svc.getFeed({ limit: 8 })) {
    const amt = `${r.amountMinor > 0n ? '+' : ''}${fromMinor(r.amountMinor, r.currency)} ${r.currency}`;
    console.log(`  ${r.transactionUid.padEnd(7)} ${r.type.padEnd(12)} ${r.accountKey.padEnd(34)} ${amt.padStart(16)}`);
  }

  line('RECONCILIATION (balance = Σ ledger)');
  const recon = await svc.reconcile();
  for (const [ccy, total] of Object.entries(recon.perCurrencyTotals)) {
    const minor = BigInt(total);
    console.log(`  Σ ${ccy} across all accounts: ${fromMinor(minor, ccy as Currency)}  ${minor === 0n ? '✓ balanced' : '✗ DIVERGENCE'}`);
  }
  console.log(`  cache divergences: ${recon.cacheDivergences.length}`);
  console.log(`\n  RESULT: ${recon.balanced && recon.consistent ? '✓ books balance, 0 divergences' : '✗ INCONSISTENT'}`);

  // Suppress unused import warning when scale-2 currencies only.
  void agentFloat;
}

function line(title: string): void {
  console.log(`\n=== ${title} ${'='.repeat(Math.max(0, 60 - title.length))}`);
}
function log(label: string, value: string): void {
  console.log(`  ${label.padEnd(40)} ${value}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
