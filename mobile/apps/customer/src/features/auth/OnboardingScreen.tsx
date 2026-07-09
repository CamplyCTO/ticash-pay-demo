import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Logo, Screen, Text, useTheme } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';

/** Customer landing: create an account (signup) or sign in (password login). */
export function OnboardingScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  return (
    <Screen background="brand">
      <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: t.spacing(6) }}>
        <View style={{ marginTop: t.spacing(8) }}>
          <Logo size={36} onBrand />
        </View>
        <View style={{ gap: t.spacing(3) }}>
          <Text variant="display" color="onBrand">{tr('onboarding.title')}</Text>
          <Text variant="subheading" color="onBrand" weight="regular" style={{ opacity: 0.82 }}>{tr('onboarding.subtitle')}</Text>
        </View>
        <View style={{ gap: t.spacing(3) }}>
          <Button title={tr('auth.createAccount')} onPress={() => router.push('/(auth)/signup')} />
          <Button title={tr('onboarding.haveAccount')} variant="ghost" onPress={() => router.push('/(auth)/login')} />
        </View>
      </View>
    </Screen>
  );
}
