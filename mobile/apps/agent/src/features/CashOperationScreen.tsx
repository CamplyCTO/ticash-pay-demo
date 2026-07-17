import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, Button, Card, Chip, Input, Row, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { formatMoneyParts, symbolOf, type AgentCustomer } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { messageForError, useAgentCashIn, useAgentCashOut, useLookupCustomer } from '@ticash/core';

const CCY = 'BRL';

export function CashOperationScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const { op } = useLocalSearchParams<{ op?: string }>();
  const isOut = op === 'cash-out';

  const [phone, setPhone] = useState('+55');
  const [customer, setCustomer] = useState<AgentCustomer | null>(null);
  const [amount, setAmount] = useState('');

  const lookup = useLookupCustomer();
  const cashIn = useAgentCashIn();
  const cashOut = useAgentCashOut();
  const opM = isOut ? cashOut : cashIn;

  // Stable idempotency key per (customer, amount, op) — retry-safe, never double-posts.
  const idem = useRef<{ sig: string; key: string } | null>(null);
  const idemKeyFor = (sig: string) => {
    if (idem.current?.sig === sig) return idem.current.key;
    const key = `app-${op}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    idem.current = { sig, key };
    return key;
  };

  const find = () => {
    if (phone.replace(/\D/g, '').length < 8) return;
    lookup.mutate(phone.trim(), { onSuccess: setCustomer, onError: (e) => toast.error(messageForError(e, tr)) });
  };

  const amountValid = Number(amount) > 0;
  const confirm = () => {
    if (!customer || !amountValid || opM.isPending) return;
    const sig = `${customer.externalId}|${amount}|${op}`;
    opM.mutate(
      { customerId: customer.externalId, currency: CCY, amount, idempotencyKey: idemKeyFor(sig) },
      { onError: (e) => toast.error(messageForError(e, tr)) },
    );
  };

  const reset = () => { opM.reset(); setCustomer(null); setAmount(''); setPhone('+55'); idem.current = null; };

  const title = isOut ? tr('agent.cashOut') : tr('agent.cashIn');

  if (opM.isSuccess) {
    const shown = formatMoneyParts(String(Math.round(Number(amount) * 100)), CCY);
    // Cash-out is now an approval request — the customer must confirm before any debit.
    return (
      <Screen footer={<Button title={tr('common.continue')} onPress={reset} />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing(4) }}>
          <View style={{ width: 88, height: 88, borderRadius: 999, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={isOut ? 'hourglass-outline' : 'checkmark'} size={48} color={t.colors.primary} />
          </View>
          <Text variant="title" center>{isOut ? 'Aguardando aprovação' : tr('agent.done')}</Text>
          <Text variant="heading" color="primary">{`${shown.symbol} ${shown.integer},${shown.fraction}`}</Text>
          <Text variant="body" color="textMuted" center>{isOut ? `O cliente ${customer?.phone} precisa aprovar no app antes do débito.` : `${title} · ${customer?.phone}`}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      footer={customer ? <Button title={tr('agent.confirm')} onPress={confirm} disabled={!amountValid} loading={opM.isPending} /> : undefined}
    >
      <Text variant="title" style={{ marginTop: t.spacing(3), marginBottom: t.spacing(5) }}>{title}</Text>

      {!customer ? (
        <>
          <Input label={tr('agent.lookupPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoFocus placeholder="+55 11 99999-9999" containerStyle={{ marginBottom: t.spacing(4) }} onSubmitEditing={find} returnKeyType="search" />
          <Button title={tr('agent.findCustomer')} variant="secondary" onPress={find} loading={lookup.isPending} left={<Ionicons name="search" size={18} color={t.colors.text} />} />
        </>
      ) : (
        <>
          <Card style={{ marginBottom: t.spacing(5) }}>
            <Row gap={3}>
              <Avatar name={customer.phone} size={48} />
              <View style={{ flex: 1 }}>
                <Text variant="subheading">{customer.phone}</Text>
                <Text variant="caption" color="textMuted">{customer.externalId}</Text>
              </View>
              {customer.kyc ? <Chip label={`${tr('profile.level')} ${customer.kyc.level}`} tone={customer.kyc.level >= 2 ? 'success' : 'warning'} /> : null}
            </Row>
          </Card>
          <Input
            label={`${tr('agent.amount')} (${CCY})`}
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
            keyboardType="decimal-pad"
            autoFocus
            placeholder="0.00"
            left={<Text weight="semibold" color="textMuted">{symbolOf(CCY)}</Text>}
          />
          <Button title={tr('common.back')} variant="ghost" onPress={() => setCustomer(null)} style={{ marginTop: t.spacing(3) }} />
        </>
      )}
    </Screen>
  );
}
