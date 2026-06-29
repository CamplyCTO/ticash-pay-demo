import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, EmptyState, ListItem, Screen, Skeleton, Text, useTheme } from '@ticash/ui';
import { formatMoneyParts, type TxRow } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { useTransactions } from '@ticash/core';

const LABEL: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  transfer: { label: 'Send', icon: 'arrow-up' },
  fund_wallet: { label: 'Deposit', icon: 'arrow-down' },
  cash_in: { label: 'Cash in', icon: 'arrow-down' },
  cash_out: { label: 'Cash out', icon: 'arrow-up' },
  airtime: { label: 'Top-up', icon: 'phone-portrait-outline' },
  payout: { label: 'Payout', icon: 'paper-plane-outline' },
  reversal: { label: 'Reversal', icon: 'refresh' },
};

export function HistoryScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { data, isLoading } = useTransactions(50);

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginTop: t.spacing(3), marginBottom: t.spacing(4) }}>{tr('tabs.activity')}</Text>
      {isLoading ? (
        <View style={{ gap: t.spacing(3) }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={56} radius={t.radius.md} />)}
        </View>
      ) : data && data.length > 0 ? (
        <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
          {data.map((row, i) => <TxItem key={row.transactionUid + ':' + i} row={row} last={i === data.length - 1} />)}
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
          <EmptyState title={tr('home.empty')} icon={<Ionicons name="receipt-outline" size={28} color={t.colors.primary} />} />
        </Card>
      )}
    </Screen>
  );
}

function TxItem({ row, last }: { row: TxRow; last: boolean }) {
  const t = useTheme();
  const meta = LABEL[row.type] ?? { label: row.type, icon: 'ellipse-outline' as const };
  const p = formatMoneyParts(row.amountMinor, row.currency);
  const credit = !p.negative;
  const date = row.createdAt.slice(0, 10);
  return (
    <ListItem
      title={meta.label}
      subtitle={date}
      left={
        <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={meta.icon} size={18} color={t.colors.primary} />
        </View>
      }
      value={`${credit ? '+' : '-'}${p.symbol} ${p.integer},${p.fraction}`}
      valueTone={credit ? 'success' : 'danger'}
      divider={!last}
    />
  );
}
