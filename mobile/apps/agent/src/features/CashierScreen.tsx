import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Balance, Card, Chip, EmptyState, Logo, Row, Screen, Skeleton, Text, useTheme } from '@ticash/ui';
import { formatMoneyParts, type Currency, type MeAgent } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { useMe } from '@ticash/core';

export function CashierScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const { data, isLoading } = useMe();
  const me = data && data.user.role === 'agent' ? (data as MeAgent) : null;
  const floats = me?.float ?? [];
  const hero = floats.find((w) => w.currency === 'BRL') ?? floats[0] ?? { currency: 'BRL' as Currency, balanceMinor: '0' };
  const parts = formatMoneyParts(hero.balanceMinor, hero.currency);
  const commission = (me?.commission ?? []).find((w) => w.currency === 'BRL');
  const comm = commission ? formatMoneyParts(commission.balanceMinor, 'BRL') : null;

  return (
    <Screen scroll>
      <Row style={{ justifyContent: 'space-between', marginBottom: t.spacing(5) }}>
        <Logo size={24} />
        <Text variant="label" color="textMuted">{tr('agent.title')}</Text>
      </Row>

      {/* Float hero */}
      <View style={{ backgroundColor: t.colors.brand, borderRadius: t.radius.xl, padding: t.spacing(6), ...t.shadow.card }}>
        {isLoading ? (
          <View style={{ gap: t.spacing(3) }}>
            <Skeleton width={120} height={14} />
            <Skeleton width={200} height={36} />
          </View>
        ) : (
          <Balance label={tr('agent.floatBalance')} code={parts.code} symbol={parts.symbol} integer={parts.integer} fraction={parts.fraction} onBrand />
        )}
        {comm ? (
          <Row style={{ marginTop: t.spacing(4) }}>
            <Chip label={`${tr('agent.earned')}: ${comm.symbol} ${comm.integer},${comm.fraction}`} tone="success" />
          </Row>
        ) : null}
      </View>

      {/* Cash in / out */}
      <Row gap={3} style={{ marginTop: t.spacing(5) }}>
        <Card onPress={() => router.push('/(app)/cash?op=cash-in')} style={{ flex: 1, alignItems: 'center', paddingVertical: t.spacing(5), gap: t.spacing(2) }}>
          <View style={{ width: 52, height: 52, borderRadius: t.radius.pill, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-down" size={24} color={t.colors.primary} />
          </View>
          <Text variant="label" weight="semibold">{tr('agent.cashIn')}</Text>
        </Card>
        <Card onPress={() => router.push('/(app)/cash?op=cash-out')} style={{ flex: 1, alignItems: 'center', paddingVertical: t.spacing(5), gap: t.spacing(2) }}>
          <View style={{ width: 52, height: 52, borderRadius: t.radius.pill, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={24} color={t.colors.primary} />
          </View>
          <Text variant="label" weight="semibold">{tr('agent.cashOut')}</Text>
        </Card>
      </Row>

      <Text variant="subheading" style={{ marginTop: t.spacing(7), marginBottom: t.spacing(2) }}>{tr('home.recent')}</Text>
      <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
        <EmptyState title={tr('agent.empty')} icon={<Ionicons name="swap-horizontal-outline" size={28} color={t.colors.primary} />} />
      </Card>
    </Screen>
  );
}
