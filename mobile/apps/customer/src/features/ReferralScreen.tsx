import React from 'react';
import { Share, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Divider, Row, Screen, Text, useTheme } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';
import { useReferral } from '@ticash/core';
import { formatMoneyParts, type Currency } from '@ticash/api-client';

function money(minor: string, currency: Currency): string {
  const p = formatMoneyParts(minor, currency);
  return `${p.symbol}${p.integer}${p.fraction ? ',' + p.fraction : ''}`;
}

export function ReferralScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { data, isLoading } = useReferral();

  const code = data?.code ?? '';
  const bonusStr = data ? money(data.bonus.amountMinor, data.bonus.currency) : '';
  const earnedStr = data ? money(data.stats.earnedMinor[data.bonus.currency] ?? '0', data.bonus.currency) : '—';

  const onShare = () => {
    if (!code) return;
    void Share.share({ message: `${tr('referral.shareMessage', { code })}` });
  };

  const stat = (label: string, value: string | number) => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>{label}</Text>
    </View>
  );

  const step = (n: number, label: string) => (
    <Row gap={3} style={{ alignItems: 'center', paddingVertical: t.spacing(2) }}>
      <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption" weight="bold" style={{ color: t.colors.primary }}>{n}</Text>
      </View>
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
    </Row>
  );

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginTop: t.spacing(3) }}>{tr('referral.title')}</Text>
      <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(6) }}>
        {tr('referral.subtitle', { bonus: bonusStr })}
      </Text>

      <Card elevated style={{ alignItems: 'center', paddingVertical: t.spacing(6), gap: t.spacing(3) }}>
        <Text variant="label" color="textMuted">{tr('referral.yourCode')}</Text>
        <Text variant="title" weight="bold" style={{ letterSpacing: 4, color: t.colors.primary }}>
          {isLoading ? '…' : code}
        </Text>
        <Button
          title={tr('referral.share')}
          onPress={onShare}
          disabled={!code}
          left={<Ionicons name="share-social-outline" size={18} color={t.colors.onPrimary} />}
          style={{ marginTop: t.spacing(2), alignSelf: 'stretch' }}
        />
      </Card>

      <Card style={{ marginTop: t.spacing(5) }}>
        <Row style={{ alignItems: 'flex-start' }}>
          {stat(tr('referral.invited'), data?.stats.referredCount ?? 0)}
          {stat(tr('referral.active'), data?.stats.rewardedCount ?? 0)}
          {stat(tr('referral.earned'), earnedStr)}
        </Row>
      </Card>

      <Card style={{ marginTop: t.spacing(5) }}>
        <Text variant="label" color="textMuted">{tr('referral.howTitle')}</Text>
        <Divider spacing={2} />
        {step(1, tr('referral.step1'))}
        {step(2, tr('referral.step2'))}
        {step(3, tr('referral.step3'))}
        {step(4, tr('referral.step4', { bonus: bonusStr }))}
      </Card>
    </Screen>
  );
}
