import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Logo, Row, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';
import { useAuthStore } from '@ticash/core';

export function ReceiveScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);

  const detail = (label: string, value: string) => (
    <View style={{ paddingVertical: t.spacing(3), borderBottomWidth: 1, borderBottomColor: t.colors.divider }}>
      <Text variant="caption" color="textMuted">{label}</Text>
      <Text variant="subheading" style={{ marginTop: 2 }}>{value}</Text>
    </View>
  );

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginTop: t.spacing(3) }}>{tr('receive.title')}</Text>
      <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(6) }}>{tr('receive.subtitle')}</Text>

      <Card elevated style={{ alignItems: 'center', paddingVertical: t.spacing(7), gap: t.spacing(4) }}>
        <Logo size={30} />
        <View style={{ width: 120, height: 120, borderRadius: t.radius.lg, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="qr-code-outline" size={72} color={t.colors.primary} />
        </View>
        <Text variant="heading">{user?.phone ?? '—'}</Text>
      </Card>

      <Card style={{ marginTop: t.spacing(5) }}>
        <Text variant="label" color="textMuted">{tr('receive.yourAccount')}</Text>
        {detail('Phone', user?.phone ?? '—')}
        <View style={{ paddingTop: t.spacing(3) }}>
          <Text variant="caption" color="textMuted">ID</Text>
          <Text variant="body" weight="semibold" style={{ marginTop: 2 }}>{user?.externalId ?? '—'}</Text>
        </View>
      </Card>

      <Button
        title={tr('receive.title')}
        variant="secondary"
        style={{ marginTop: t.spacing(5) }}
        left={<Ionicons name="share-outline" size={18} color={t.colors.text} />}
        onPress={() => toast.success(tr('receive.copied'))}
      />
    </Screen>
  );
}
