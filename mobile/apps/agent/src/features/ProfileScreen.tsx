import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, Button, Card, Chip, Divider, Row, Screen, Text, useTheme, useThemePreference, type ColorSchemePreference } from '@ticash/ui';
import { LOCALE_LABEL, LOCALES, useI18n, type Locale } from '@ticash/i18n';
import type { MeAgent } from '@ticash/api-client';
import { useAuthStore, useMe } from '@ticash/core';

export function ProfileScreen() {
  const t = useTheme();
  const { t: tr, locale, setLocale } = useI18n();
  const { preference, setPreference } = useThemePreference();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const { data } = useMe();
  const me = data && data.user.role === 'agent' ? (data as MeAgent) : null;

  const themes: { key: ColorSchemePreference; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'light', icon: 'sunny-outline' },
    { key: 'dark', icon: 'moon-outline' },
    { key: 'system', icon: 'phone-portrait-outline' },
  ];

  return (
    <Screen scroll>
      <Row gap={4} style={{ marginVertical: t.spacing(4) }}>
        <Avatar name={user?.externalId ?? user?.phone ?? '?'} size={56} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">{user?.externalId ?? '—'}</Text>
          <Text variant="caption" color="textMuted">{user?.phone ?? ''}</Text>
        </View>
        {me?.agent ? <Chip label={`${tr('agent.commissions')} ${(me.agent.commissionBps / 100).toFixed(2)}%`} tone="success" /> : null}
      </Row>

      <Card style={{ marginBottom: t.spacing(4) }}>
        <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(3) }}>{tr('profile.language')}</Text>
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {LOCALES.map((l: Locale) => {
            const active = l === locale;
            return (
              <Pressable key={l} onPress={() => setLocale(l)} style={{ paddingHorizontal: t.spacing(4), paddingVertical: t.spacing(2.5), borderRadius: t.radius.pill, backgroundColor: active ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border }}>
                <Text variant="label" weight="semibold" style={{ color: active ? t.colors.onPrimary : t.colors.text }}>{LOCALE_LABEL[l]}</Text>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      <Card style={{ marginBottom: t.spacing(4) }}>
        <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(3) }}>{tr('profile.theme')}</Text>
        <Row gap={2}>
          {themes.map((th) => {
            const active = th.key === preference;
            return (
              <Pressable key={th.key} onPress={() => setPreference(th.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: t.spacing(3), borderRadius: t.radius.md, backgroundColor: active ? t.colors.primarySoft : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border, gap: t.spacing(1) }}>
                <Ionicons name={th.icon} size={20} color={active ? t.colors.primary : t.colors.textMuted} />
                <Text variant="caption" weight="semibold" style={{ color: active ? t.colors.primary : t.colors.textMuted, textTransform: 'capitalize' }}>{th.key}</Text>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      <Divider spacing={2} />
      <Button title={tr('profile.logout')} variant="danger" onPress={() => { void signOut(); }} style={{ marginTop: t.spacing(4) }} />
    </Screen>
  );
}
