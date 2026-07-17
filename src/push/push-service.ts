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

  /** Tell a seller a buyer opened an order against their USDT offer. */
  notifyP2PNewOrder(externalId: string, assetMinor: bigint): Promise<number> {
    const amount = `${CURRENCIES.USDT.symbol} ${fromMinor(assetMinor, 'USDT')}`;
    return this.dispatchToExternalId(externalId, {
      title: 'Novo pedido de USDT',
      body: `Alguém quer comprar ${amount} de USDT de você. Toque para ver.`,
      data: { type: 'p2p_new_order', screen: '/(app)/usdt' },
    });
  }

  /** Tell a seller a buyer marked payment sent — confirm receipt and release. */
  notifyP2PPaymentSubmitted(externalId: string, currency: Currency, fiatMinor: bigint): Promise<number> {
    const amount = `${CURRENCIES[currency].symbol} ${fromMinor(fiatMinor, currency)}`;
    return this.dispatchToExternalId(externalId, {
      title: 'Pagamento informado',
      body: `Um comprador informou o pagamento de ${amount}. Confira e libere o USDT.`,
      data: { type: 'p2p_payment', screen: '/(app)/usdt' },
    });
  }

  /** Ask a customer to approve a pending cash-out (an agent-initiated withdrawal). */
  notifyCashoutRequest(externalId: string, currency: Currency, amountMinor: bigint): Promise<number> {
    const amount = `${CURRENCIES[currency].symbol} ${fromMinor(amountMinor, currency)}`;
    return this.dispatchToExternalId(externalId, {
      title: 'Aprovar retirada?',
      body: `Um agente pediu para retirar ${amount} da sua conta. Toque para aprovar ou recusar.`,
      data: { type: 'cashout_request', currency, amountMinor: amountMinor.toString(), screen: '/(app)/cashout' },
    });
  }
}
