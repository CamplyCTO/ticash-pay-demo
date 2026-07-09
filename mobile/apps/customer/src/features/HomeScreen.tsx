import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Balance, Card, Chip, EmptyState, Logo, Row, Screen, Skeleton, Text, useTheme, useToast } from '@ticash/ui';
import { formatMoneyParts, isCustomerMe, type Currency } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { useMe, FEATURE_USDT } from '@ticash/core';
import { currencyForCountry } from './auth/countries';

type ActionKey = 'send' | 'deposit' | 'receive' | 'topup' | 'usdt';
const ALL_ACTIONS: { key: ActionKey; icon: keyof typeof Ionicons.glyphMap; route?: string }[] = [
  { key: 'send', icon: 'arrow-up', route: '/(app)/send' },
  { key: 'deposit', icon: 'add-circle-outline', route: '/(app)/deposit' }, // add balance via PIX
  { key: 'receive', icon: 'arrow-down', route: '/(app)/receive' },
  { key: 'topup', icon: 'phone-portrait-outline', route: '/(app)/topup' },
  { key: 'usdt', icon: 'logo-bitcoin' }, // WS-4 — hidden in v1 (FEATURE_USDT)
];
// v1 store build hides the USDT action; re-enabled by FEATURE_USDT for v2.
const ACTIONS = ALL_ACTIONS.filter((a) => a.key !== 'usdt' || FEATURE_USDT);

export function HomeScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const { data, isLoading } = useMe();
  const me = data && isCustomerMe(data) ? data : null;
  const wallets = me?.wallets ?? [];
  // Home balance shows the user's country currency (BR→BRL, MX→MXN, …).
  const homeCcy = currencyForCountry(me?.user.country) as Currency;
  const hero = wallets.find((w) => w.currency === homeCcy) ?? wallets[0] ?? { currency: homeCcy, balanceMinor: '0' };
  const parts = formatMoneyParts(hero.balanceMinor, hero.currency);
  const others = wallets.filter((w) => w !== hero);

  return (
    <Screen scroll>
      <Row style={{ justifyContent: 'space-between', marginBottom: t.spacing(5) }}>
        <View>
          <Text variant="label" color="textMuted">{tr('home.greeting')}</Text>
          <Logo size={24} />
        </View>
        {me?.kyc ? <Chip label={`${tr('profile.kyc')} · ${tr('profile.level')} ${me.kyc.level}`} tone={me.kyc.level >= 2 ? 'success' : 'warning'} /> : null}
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
        <Text variant="label" color="primary">{tr('home.seeAll')}</Text>
      </Row>
      <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
        <EmptyState
          title={tr('home.empty')}
          icon={<Ionicons name="receipt-outline" size={28} color={t.colors.primary} />}
        />
      </Card>
    </Screen>
  );
}
