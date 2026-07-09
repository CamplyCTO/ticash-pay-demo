import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, EmptyState, ListItem, Screen, Skeleton, Text, useTheme } from '@ticash/ui';
import { formatMoneyParts, type TxRow } from '@ticash/api-client';
import { useI18n, type Translate } from '@ticash/i18n';
import { useTransactions } from '@ticash/core';

/** Operation label per ledger type (type-safe fixed keys; unknown types show raw). */
function typeLabel(type: string, tr: Translate): string {
  switch (type) {
    case 'transfer': return tr('activity.send');
    case 'fund_wallet': return tr('activity.deposit');
    case 'cash_in': return tr('activity.cashIn');
    case 'cash_out': return tr('activity.cashOut');
    case 'airtime': return tr('activity.topup');
    case 'payout': return tr('activity.payout');
    case 'reversal': return tr('activity.reversal');
    default: return type;
  }
}

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  transfer: 'arrow-up',
  fund_wallet: 'arrow-down',
  cash_in: 'arrow-down',
  cash_out: 'arrow-up',
  airtime: 'phone-portrait-outline',
  payout: 'paper-plane-outline',
  reversal: 'refresh',
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

function railLabel(rail?: string | null): string {
  return rail === 'moncash' ? 'MonCash' : rail === 'natcash' ? 'NatCash' : '';
}

function TxItem({ row, last }: { row: TxRow; last: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const isSend = row.type === 'transfer';
  const icon = ICON[row.type] ?? 'ellipse-outline';
  const p = formatMoneyParts(row.amountMinor, row.currency);
  const credit = !p.negative;
  const date = row.createdAt.slice(0, 10);

  // Sends show the recipient; everything else shows the operation label.
  const label = typeLabel(row.type, tr);
  const title = isSend && row.recipientName ? row.recipientName : label;
  const status = row.transferStatus ? (row.transferStatus === 'completed' ? tr('activity.completed') : tr('activity.processing')) : '';
  const subtitle = isSend
    ? [row.recipientRef, railLabel(row.payoutRail), status, date].filter(Boolean).join(' · ')
    : date;

  return (
    <ListItem
      title={title}
      subtitle={subtitle}
      left={
        <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={18} color={t.colors.primary} />
        </View>
      }
      value={`${credit ? '+' : '-'}${p.symbol} ${p.integer},${p.fraction}`}
      valueTone={credit ? 'success' : 'danger'}
      divider={!last}
    />
  );
}
