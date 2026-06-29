import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, EmptyState, Input, ListItem, Row, Screen, Skeleton, Text, useTheme, useToast } from '@ticash/ui';
import { formatMoneyParts, formatPlain, type AirtimeProduct } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { messageForError, useAirtimeProducts, useAirtimeTopup } from '@ticash/core';

const COUNTRIES = ['HT', 'BR', 'DO', 'MX'];

export function TopupScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const [country, setCountry] = useState('HT');
  const [phone, setPhone] = useState('');
  const [sku, setSku] = useState<AirtimeProduct | null>(null);
  const products = useAirtimeProducts(country);
  const topup = useAirtimeTopup();

  const costOf = (p: AirtimeProduct): string => String(p.costMinor ?? p.retailMinor ?? '0');
  const pay = () => {
    if (!sku || phone.trim().length < 5) return;
    topup.mutate(
      { country, accountNumber: phone.trim(), skuCode: sku.skuCode, cost: formatPlain(costOf(sku), 'BRL') },
      { onSuccess: () => { toast.success(tr('topup.done')); setSku(null); setPhone(''); }, onError: (e) => toast.error(messageForError(e, tr)) },
    );
  };

  const list = (products.data ?? []) as AirtimeProduct[];

  return (
    <Screen scroll footer={<Button title={tr('topup.pay')} onPress={pay} disabled={!sku || phone.trim().length < 5} loading={topup.isPending} />}>
      <Text variant="title" style={{ marginTop: t.spacing(3), marginBottom: t.spacing(5) }}>{tr('topup.title')}</Text>

      <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(2) }}>{tr('topup.country')}</Text>
      <Row gap={2} style={{ flexWrap: 'wrap', marginBottom: t.spacing(5) }}>
        {COUNTRIES.map((c) => {
          const active = c === country;
          return (
            <Pressable key={c} onPress={() => { setCountry(c); setSku(null); }} style={{ paddingHorizontal: t.spacing(4), paddingVertical: t.spacing(2.5), borderRadius: t.radius.pill, backgroundColor: active ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border }}>
              <Text variant="label" weight="semibold" style={{ color: active ? t.colors.onPrimary : t.colors.text }}>{c}</Text>
            </Pressable>
          );
        })}
      </Row>

      <Input label={tr('topup.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="50912345678" containerStyle={{ marginBottom: t.spacing(5) }} />

      <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(2) }}>{tr('topup.product')}</Text>
      {products.isLoading ? (
        <View style={{ gap: t.spacing(2) }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={52} radius={t.radius.md} />)}</View>
      ) : list.length > 0 ? (
        <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
          {list.slice(0, 8).map((p, i) => {
            const price = formatMoneyParts(costOf(p), 'BRL');
            const selected = sku?.skuCode === p.skuCode;
            return (
              <ListItem
                key={p.skuCode + i}
                title={String(p.description ?? p.skuCode)}
                subtitle={p.skuCode}
                value={`R$ ${price.integer},${price.fraction}`}
                right={selected ? <Ionicons name="checkmark-circle" size={20} color={t.colors.primary} /> : undefined}
                onPress={() => setSku(p)}
                divider={i < Math.min(list.length, 8) - 1}
              />
            );
          })}
        </Card>
      ) : (
        <EmptyState title={tr('topup.empty')} icon={<Ionicons name="phone-portrait-outline" size={26} color={t.colors.primary} />} />
      )}
    </Screen>
  );
}
