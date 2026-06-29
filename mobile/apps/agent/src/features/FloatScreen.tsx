import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Card, EmptyState, ListItem, Screen, Text, useTheme } from '@ticash/ui';
import { formatMoneyParts, type MeAgent } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { useMe } from '@ticash/core';

export function FloatScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { data } = useMe();
  const me = data && data.user.role === 'agent' ? (data as MeAgent) : null;
  const floats = me?.float ?? [];

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginTop: t.spacing(4), marginBottom: t.spacing(5) }}>{tr('agent.floatBalance')}</Text>
      {floats.length > 0 ? (
        <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
          {floats.map((w, i) => {
            const p = formatMoneyParts(w.balanceMinor, w.currency);
            return <ListItem key={w.currency} title={w.currency} subtitle={p.symbol} value={`${p.integer},${p.fraction}`} divider={i < floats.length - 1} />;
          })}
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
          <EmptyState title={tr('agent.empty')} icon={<Ionicons name="wallet-outline" size={28} color={t.colors.primary} />} />
        </Card>
      )}
    </Screen>
  );
}
