import { Currency, CURRENCIES } from '../money/currency';
import { fromMinor } from '../money/money';
import { AuthStore } from '../auth/auth-store';
import { PushTokenStore } from './push-token-store';
import { PushSender } from './push-sender';
import { PushNotification, RegisterTokenInput } from './types';

/**
 * Push orchestration: device registration + event dispatch. Dispatch resolves a
 * party id (customers/agents.external_id) → its app_users → their active device
 * tokens, then sends via the pluggable sender. Dispatch is BEST-EFFORT: callers
 * wrap it so a push failure can never affect the money operation.
 */
export class PushService {
  constructor(
    private readonly tokens: PushTokenStore,
    private readonly authStore: AuthStore,
    private readonly sender: PushSender,
  ) {}

  register(input: RegisterTokenInput): Promise<void> {
    return this.tokens.upsert(input);
  }
  unregister(expoToken: string): Promise<void> {
    return this.tokens.disable(expoToken);
  }

  /** Send a notification to every active device of every app_user behind a party id. */
  async dispatchToExternalId(externalId: string, n: PushNotification): Promise<number> {
    const users = await this.authStore.findUsersByExternalId(externalId);
    const all: string[] = [];
    for (const u of users) all.push(...(await this.tokens.tokensForUser(u.id)));
    const unique = [...new Set(all)];
    if (unique.length > 0) await this.sender.send(unique, n);
    return unique.length;
  }

  /** "Money received" alert for a customer credit (agent cash-in, PIX fund-wallet). */
  notifyMoneyIn(externalId: string, currency: Currency, amountMinor: bigint): Promise<number> {
    const amount = `${CURRENCIES[currency].symbol} ${fromMinor(amountMinor, currency)}`;
    return this.dispatchToExternalId(externalId, {
      title: 'Dinheiro recebido',
      body: `Você recebeu ${amount}`,
      data: { type: 'money_in', currency, amountMinor: amountMinor.toString(), screen: '/(app)/activity' },
    });
  }
}
