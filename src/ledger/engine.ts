import { Currency } from '../money/currency';
import { JournalDraft, PostingDraft } from './types';

/**
 * The non-negotiable invariant: a journal must be balanced — the signed sum of
 * its postings must be exactly zero for EVERY currency it touches.
 *
 * This is what makes the system double-entry: money is never created or
 * destroyed, only moved between accounts.
 */
export function sumByCurrency(postings: readonly PostingDraft[]): Map<Currency, bigint> {
  const totals = new Map<Currency, bigint>();
  for (const p of postings) {
    if (p.currency !== p.account.currency) {
      throw new LedgerError(
        `posting currency ${p.currency} does not match account currency ${p.account.currency}`,
      );
    }
    if (p.amountMinor === 0n) {
      throw new LedgerError('zero-amount postings are not allowed');
    }
    totals.set(p.currency, (totals.get(p.currency) ?? 0n) + p.amountMinor);
  }
  return totals;
}

export function assertBalanced(journal: JournalDraft): void {
  if (journal.postings.length < 2) {
    throw new LedgerError('a journal needs at least two postings');
  }
  const totals = sumByCurrency(journal.postings);
  for (const [currency, total] of totals) {
    if (total !== 0n) {
      throw new LedgerError(
        `unbalanced journal: ${currency} nets ${total} (must be 0)`,
        'UNBALANCED',
      );
    }
  }
}

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'UNBALANCED'
      | 'INSUFFICIENT_FUNDS'
      | 'IDEMPOTENCY_CONFLICT'
      | 'VALIDATION' = 'VALIDATION',
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}
