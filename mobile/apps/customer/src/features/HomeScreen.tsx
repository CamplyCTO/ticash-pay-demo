import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Balance, Card, Chip, EmptyState, ListItem, Logo, Row, Screen, Skeleton, Text, useTheme, useToast } from '@ticash/ui';
import { formatMoneyParts, isCustomerMe, type Currency, type TxRow } from '@ticash/api-client';
import { useI18n, type Translate } from '@ticash/i18n';
import { useMe, useTransactions, useCashoutPending, FEATURE_USDT, FEATURE_AIRTIME } from '@ticash/core';
import { currencyForCountry } from './auth/countries';

const TX_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  transfer: 'arrow-up', fund_wallet: 'arrow-down', cash_in: 'arrow-down', cash_out: 'arrow-up',
  airtime: 'phone-portrait-outline', payout: 'paper-plane-outline', reversal: 'refresh',
};
function txLabel(type: string, tr: Translate): string {
  const k: Record<string, string> = { transfer: 'activity.send', fund_wallet: 'activity.deposit', cash_in: 'activity.cashIn', cash_out: 'activity.cashOut', airtime: 'activity.topup', payout: 'activity.payout', reversal: 'activity.reversal' };
  return k[type] ? tr(k[type] as never) : type;
}

type ActionKey = 'send' | 'deposit' | 'receive' | 'topup' | 'usdt';
const ALL_ACTIONS: { key: ActionKey; icon: keyof typeof Ionicons.glyphMap; route?: string }[] = [
  { key: 'send', icon: 'arrow-up', route: '/(app)/send' },
  { key: 'deposit', icon: 'add-circle-outline', route: '/(app)/deposit' }, // add balance via PIX
  { key: 'receive', icon: 'arrow-down', route: '/(app)/receive' },
  { key: 'topup', icon: 'phone-portrait-outline', route: '/(app)/topup' },
  { key: 'usdt', icon: 'logo-bitcoin' }, // WS-4 — hidden in v1 (FEATURE_USDT)
];
// v1 store build hides the USDT action (crypto policy) and airtime (DingConnect not
// yet provisioned); each re-appears via its feature flag.
const ACTIONS = ALL_ACTIONS.filter(
  (a) => (a.key !== 'usdt' || FEATURE_USDT) && (a.key !== 'topup' || FEATURE_AIRTIME),
);

export function HomeScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const { data, isLoading, refetch: refetchMe, isFetching } = useMe();
  const txq = useTransactions(50);
  const me = data && isCustomerMe(data) ? data : null;
  const wallets = me?.wallets ?? [];
  // Home balance shows the user's country currency (BR→BRL, MX→MXN, …).
  const homeCcy = currencyForCountry(me?.user.country) as Currency;
  const hero = wallets.find((w) => w.currency === homeCcy) ?? wallets[0] ?? { currency: homeCcy, balanceMinor: '0' };
  const parts = formatMoneyParts(hero.balanceMinor, hero.currency);
  const others = wallets.filter((w) => w !== hero);
  const recent = (txq.data ?? []).slice(0, 4);
  const pendingCashout = useCashoutPending().data ?? [];
  const refreshAll = () => { void refetchMe(); void txq.refetch(); };

  return (
    <Screen scroll>
      <Row style={{ justifyContent: 'space-between', marginBottom: t.spacing(5) }}>
        <View>
          <Text variant="label" color="textMuted">{tr('home.greeting')}</Text>
          <Logo size={24} />
        </View>
        <Row gap={2} style={{ alignItems: 'center' }}>
          {me?.kyc ? <Chip label={`${tr('profile.kyc')} · ${tr('profile.level')} ${me.kyc.level}`} tone={me.kyc.level >= 2 ? 'success' : 'warning'} /> : null}
          <Pressable onPress={refreshAll} hitSlop={10} style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="refresh" size={18} color={isFetching || txq.isFetching ? t.colors.primary : t.colors.textMuted} />
          </Pressable>
        </Row>
      </Row>

      {/* Hero balance card (navy chrome regardless of theme) */}
      <View style={{ backgroundColor: t.colors.brand, borderRadius: t.radius.xl, padding: t.spacing(6), ...t.shadow.card }}>
        {isLoading ? (
          <View style={{ gap: t.spacing(3) }}>
            <Skeleton width={120} height={14} />
            <Skeleton width={200} height={36} />
          </View>
        ) : (
          <Balance label={tr('home.totalBalance')} code={parts.code} symbol={parts.symbol} integer={parts.integer} fraction={parts.fraction} onBrand />
        )}
        {others.length > 0 ? (
          <Row gap={2} style={{ marginTop: t.spacing(4), flexWrap: 'wrap' }}>
            {others.map((w) => {
              const p = formatMoneyParts(w.balanceMinor, w.currency);
              return <Chip key={w.currency} label={`${p.symbol} ${p.integer},${p.fraction} ${w.currency}`} tone="info" />;
            })}
          </Row>
        ) : null}
      </View>

      {/* Pending cash-out approvals — a withdrawal needs the customer's OK */}
      {pendingCashout.length > 0 ? (
        <Pressable onPress={() => router.push('/(app)/cashout')}>
          <Card style={{ marginTop: t.spacing(4), backgroundColor: t.colors.primarySoft, flexDirection: 'row', alignItems: 'center', gap: t.spacing(3) }}>
            <Ionicons name="shield-half-outline" size={22} color={t.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="bold">Retirada aguardando aprovação</Text>
              <Text variant="caption" color="textMuted">{`${pendingCashout.length} pedido(s) — toque para aprovar ou recusar`}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.colors.textMuted} />
          </Card>
        </Pressable>
      ) : null}

      {/* Quick actions */}
      <Row gap={3} style={{ marginTop: t.spacing(5) }}>
        {ACTIONS.map((a) => (
          <Card key={a.key} onPress={() => (a.route ? router.push(a.route) : toast.show(tr('home.usdt')))} style={{ flex: 1, alignItems: 'center', paddingVertical: t.spacing(4), gap: t.spacing(2) }}>
            <View style={{ width: 44, height: 44, borderRadius: t.radius.pill, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={a.icon} size={20} color={t.colors.primary} />
            </View>
            <Text variant="caption" weight="semibold">{tr(`home.${a.key}`)}</Text>
          </Card>
        ))}
      </Row>

      {/* Recent activity */}
      <Row style={{ justifyContent: 'space-between', marginTop: t.spacing(7), marginBottom: t.spacing(2) }}>
        <Text variant="subheading">{tr('home.recent')}</Text>
        <Pressable onPress={() => router.push('/(app)/activity')}><Text variant="label" color="primary">{tr('home.seeAll')}</Text></Pressable>
      </Row>
      <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
        {recent.length > 0 ? (
          recent.map((row, i) => <HomeTxItem key={row.transactionUid + ':' + i} row={row} last={i === recent.length - 1} />)
        ) : (
          <EmptyState title={tr('home.empty')} icon={<Ionicons name="receipt-outline" size={28} color={t.colors.primary} />} />
        )}
      </Card>
    </Screen>
  );
}

function HomeTxItem({ row, last }: { row: TxRow; last: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const p = formatMoneyParts(row.amountMinor, row.currency);
  const credit = !p.negative;
  const isSend = row.type === 'transfer';
  const title = isSend && row.recipientName ? row.recipientName : txLabel(row.type, tr);
  return (
    <ListItem
      title={title}
      subtitle={row.createdAt.slice(0, 10)}
      left={<View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={TX_ICON[row.type] ?? 'ellipse-outline'} size={18} color={t.colors.primary} /></View>}
      value={`${credit ? '+' : '-'}${p.symbol} ${p.integer},${p.fraction}`}
      valueTone={credit ? 'success' : 'danger'}
      divider={!last}
    />
  );
}
