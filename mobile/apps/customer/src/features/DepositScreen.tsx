import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Input, Row, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { formatPlain, isCustomerMe } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { messageForError, useDepositPix, useMe } from '@ticash/core';

/** Add balance via PIX: enter amount + payer (name/CPF), get a PIX code + QR to pay.
 *  The wallet is credited automatically when the Lytex webhook confirms payment. */
export function DepositScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const deposit = useDepositPix();
  const me = useMe();
  // PIX cash-in is Brazil-only (requires a CPF). Other countries fund via an agent
  // (or card / PayPal, coming later) — never show the CPF form to a non-BR account.
  const meData = me.data && isCustomerMe(me.data) ? me.data : null;
  const pixAvailable = (meData?.user.country ?? 'BR') === 'BR';

  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [charge, setCharge] = useState<{ amountMinor: string; pix: { copyPaste?: string; qrCodeImage?: string } } | null>(null);

  const amountNum = Number(amount.replace(',', '.'));
  const valid = amountNum > 0 && name.trim().length >= 2 && cpf.replace(/\D/g, '').length >= 11;

  const submit = () => {
    if (!valid || deposit.isPending) return;
    deposit.mutate(
      { amount: amountNum.toFixed(2), payerName: name.trim(), payerCpf: cpf },
      {
        onSuccess: (r) => setCharge({ amountMinor: r.amountMinor, pix: r.pix ?? {} }),
        onError: (e) => toast.error(messageForError(e, tr)),
      },
    );
  };

  // ---- payment view: show the PIX code + QR, wait for settlement -----------
  if (charge) {
    const code = charge.pix.copyPaste ?? '';
    const img = charge.pix.qrCodeImage;
    const uri = img ? (img.startsWith('data:') || img.startsWith('http') ? img : `data:image/png;base64,${img}`) : null;
    return (
      <Screen scroll>
        <Text variant="title" style={{ marginTop: t.spacing(3) }}>{tr('deposit.payTitle')}</Text>
        <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(5) }}>{tr('deposit.paySubtitle')}</Text>

        <Card elevated style={{ alignItems: 'center', gap: t.spacing(4), paddingVertical: t.spacing(6) }}>
          <Text variant="heading">R$ {formatPlain(charge.amountMinor, 'BRL')}</Text>
          {uri ? (
            <Image source={{ uri }} style={{ width: 200, height: 200, borderRadius: t.radius.lg }} resizeMode="contain" />
          ) : (
            <View style={{ width: 200, height: 200, borderRadius: t.radius.lg, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="qr-code-outline" size={90} color={t.colors.primary} />
            </View>
          )}
          {code ? (
            <View style={{ width: '100%' }}>
              <Text variant="caption" color="textMuted" style={{ marginBottom: t.spacing(1) }}>{tr('deposit.copyCode')}</Text>
              <View style={{ borderWidth: 1, borderColor: t.colors.divider, borderRadius: t.radius.md, padding: t.spacing(3) }}>
                <Text selectable variant="caption">{code}</Text>
              </View>
            </View>
          ) : null}
        </Card>

        <Text variant="caption" color="textMuted" style={{ textAlign: 'center', marginTop: t.spacing(4) }}>{tr('deposit.waiting')}</Text>
        <Button title={tr('deposit.refresh')} variant="secondary" loading={me.isFetching} style={{ marginTop: t.spacing(5) }} onPress={() => void me.refetch()} />
        <Button title={tr('common.back')} variant="ghost" style={{ marginTop: t.spacing(2) }} onPress={() => router.back()} />
      </Screen>
    );
  }

  // ---- non-Brazil: PIX unavailable (no CPF) -> point to an agent -----------
  if (!pixAvailable) {
    return (
      <Screen scroll>
        <Text variant="title" style={{ marginTop: t.spacing(3) }}>{tr('deposit.title')}</Text>
        <Card style={{ marginTop: t.spacing(6), alignItems: 'center', gap: t.spacing(3), paddingVertical: t.spacing(7) }}>
          <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="business-outline" size={30} color={t.colors.primary} />
          </View>
          <Text variant="subheading" center>{tr('deposit.unavailableTitle')}</Text>
          <Text variant="body" color="textMuted" center>{tr('deposit.unavailableBody')}</Text>
        </Card>
        <Button title={tr('common.back')} variant="ghost" style={{ marginTop: t.spacing(4) }} onPress={() => router.back()} />
      </Screen>
    );
  }

  // ---- form view -----------------------------------------------------------
  return (
    <Screen scroll footer={<Button title={tr('deposit.generate')} loading={deposit.isPending} disabled={!valid} onPress={submit} />}>
      <Text variant="title" style={{ marginTop: t.spacing(3) }}>{tr('deposit.title')}</Text>
      <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(6) }}>{tr('deposit.subtitle')}</Text>

      <Input label={tr('deposit.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" left={<Text color="textMuted">R$</Text>} />
      <View style={{ height: t.spacing(4) }} />
      <Input label={tr('deposit.name')} value={name} onChangeText={setName} placeholder={tr('deposit.namePlaceholder')} autoCapitalize="words" />
      <View style={{ height: t.spacing(4) }} />
      <Input label={tr('deposit.cpf')} value={cpf} onChangeText={setCpf} keyboardType="number-pad" placeholder="000.000.000-00" />

      <Card style={{ marginTop: t.spacing(6), backgroundColor: t.colors.primarySoft }}>
        <Row gap={2} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="flash-outline" size={18} color={t.colors.primary} />
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>{tr('deposit.hint')}</Text>
        </Row>
      </Card>
    </Screen>
  );
}
