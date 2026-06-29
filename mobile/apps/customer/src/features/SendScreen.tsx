import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Divider, EmptyState, Input, Row, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { formatMoneyParts, symbolOf, type Currency, type TransferPricing } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { messageForError, useQuote, useSendTransfer } from '@ticash/core';

const DEST: Currency[] = ['HTG', 'USD', 'MXN', 'DOP'];
const FROM: Currency = 'BRL';

export function SendScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();

  const [to, setTo] = useState<Currency>('HTG');
  const [amount, setAmount] = useState('');
  const [debounced, setDebounced] = useState('');
  const [recipient, setRecipient] = useState('');
  const send = useSendTransfer();

  // Stable idempotency key per logical send: same (corridor, amount, recipient) ->
  // same key, so a retry after a lost response can never double-send money. A new
  // key is minted only when the inputs change.
  const idem = useRef<{ sig: string; key: string } | null>(null);
  const idemKeyFor = (sig: string): string => {
    if (idem.current?.sig === sig) return idem.current.key;
    const key = `app-xfer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    idem.current = { sig, key };
    return key;
  };

  useEffect(() => {
    const id = setTimeout(() => setDebounced(amount), 400);
    return () => clearTimeout(id);
  }, [amount]);

  const quote = useQuote(FROM, to, debounced);
  const amountValid = Number(amount) > 0;
  const recipientValid = recipient.trim().length >= 5;
  // Only enable once the live quote matches the CURRENT amount (no stale-quote sends).
  const quoteReady = !!quote.data && debounced === amount;
  const canSend = amountValid && recipientValid && quoteReady && !send.isPending;

  const onSend = () => {
    if (!canSend) return;
    const sig = `${FROM}|${to}|${amount}|${recipient.trim()}`;
    send.mutate(
      { recipientRef: recipient.trim(), fromCurrency: FROM, toCurrency: to, sendAmount: amount, idempotencyKey: idemKeyFor(sig) },
      { onError: (e) => toast.error(messageForError(e, tr)) },
    );
  };

  const reset = () => {
    send.reset();
    setAmount('');
    setDebounced('');
    setRecipient('');
    idem.current = null;
  };

  if (send.isSuccess && send.data) {
    const recv = formatMoneyParts(send.data.quote.receiveMinor, to);
    return (
      <Screen footer={<Button title={tr('common.continue')} onPress={reset} />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing(4) }}>
          <View style={{ width: 88, height: 88, borderRadius: 999, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="checkmark" size={48} color={t.colors.primary} />
          </View>
          <Text variant="title" center>{tr('send.sent')}</Text>
          <Text variant="heading" color="primary">{`${recv.symbol} ${recv.integer},${recv.fraction} ${to}`}</Text>
          <Text variant="body" color="textMuted" center>{tr('send.toRecipient', { recipient: recipient.trim() })}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll footer={<Button title={tr('send.title')} onPress={onSend} disabled={!canSend} loading={send.isPending} />}>
      <Text variant="title" style={{ marginTop: t.spacing(3), marginBottom: t.spacing(5) }}>{tr('send.title')}</Text>

      <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(2) }}>{tr('send.destination')}</Text>
      <Row gap={2} style={{ flexWrap: 'wrap', marginBottom: t.spacing(5) }}>
        {DEST.map((c) => {
          const active = c === to;
          return (
            <Pressable key={c} onPress={() => setTo(c)} style={{ paddingHorizontal: t.spacing(4), paddingVertical: t.spacing(2.5), borderRadius: t.radius.pill, backgroundColor: active ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border }}>
              <Text variant="label" weight="semibold" style={{ color: active ? t.colors.onPrimary : t.colors.text }}>{c}</Text>
            </Pressable>
          );
        })}
      </Row>

      <Input
        label={`${tr('send.youSend')} (${FROM})`}
        value={amount}
        onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
        keyboardType="decimal-pad"
        placeholder="0.00"
        left={<Text weight="semibold" color="textMuted">{symbolOf(FROM)}</Text>}
        containerStyle={{ marginBottom: t.spacing(4) }}
      />

      <Input
        label={tr('send.recipient')}
        value={recipient}
        onChangeText={setRecipient}
        placeholder="50912345678"
        keyboardType="default"
        containerStyle={{ marginBottom: t.spacing(5) }}
      />

      {/* Live quote */}
      {amountValid ? (
        <Card>
          {quote.isLoading || debounced !== amount ? (
            <Text variant="body" color="textMuted" center>{tr('common.loading')}</Text>
          ) : quote.data ? (
            <QuoteBody from={FROM} to={to} pricing={quote.data} />
          ) : (
            <Text variant="caption" color="danger" center>{tr('send.noRate')}</Text>
          )}
        </Card>
      ) : (
        <EmptyState title={tr('send.enterAmount')} icon={<Ionicons name="cash-outline" size={26} color={t.colors.primary} />} />
      )}
    </Screen>
  );
}

function QuoteBody({ from, to, pricing }: { from: Currency; to: Currency; pricing: TransferPricing }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const total = formatMoneyParts(pricing.totalDebitMinor, from);
  const recv = formatMoneyParts(pricing.netToRecipientMinor, to);
  const fee = formatMoneyParts(pricing.platformFeeMinor, from);
  const line = (label: string, value: string, strong?: boolean) => (
    <Row style={{ justifyContent: 'space-between', paddingVertical: t.spacing(1.5) }}>
      <Text variant="body" color="textMuted">{label}</Text>
      <Text variant="body" weight={strong ? 'bold' : 'semibold'} color={strong ? 'primary' : 'text'}>{value}</Text>
    </Row>
  );
  return (
    <View>
      {line(tr('send.rate'), `1 ${from} = ${pricing.rate} ${to}`)}
      {line(tr('send.fee'), `${fee.symbol} ${fee.integer},${fee.fraction}`)}
      {line(tr('send.youPay'), `${total.symbol} ${total.integer},${total.fraction}`)}
      <Divider spacing={1} />
      {line(tr('send.recipientGets'), `${recv.symbol} ${recv.integer},${recv.fraction} ${to}`, true)}
    </View>
  );
}
