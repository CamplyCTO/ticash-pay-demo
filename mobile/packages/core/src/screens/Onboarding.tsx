import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Logo, Screen, Text, useTheme } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';

/** Shared onboarding hero. Copy defaults to the customer story; the agent app passes
 *  its own title/subtitle so it doesn't show customer remittance marketing.
 *
 *  `allowSignUp` (default true) gates self-registration. The agent app passes false:
 *  agents are admin-provisioned only (the backend has no agent self-signup — `register`
 *  always creates a customer), so the agent onboarding shows a single "Sign in" CTA and
 *  a note telling the agent to ask the admin to register them. `note` renders above the
 *  buttons when provided. */
export function OnboardingScreen({
  title,
  subtitle,
  allowSignUp = true,
  note,
}: { title?: string; subtitle?: string; allowSignUp?: boolean; note?: string } = {}) {
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
          <Text variant="display" color="onBrand">{title ?? tr('onboarding.title')}</Text>
          <Text variant="subheading" color="onBrand" weight="regular" style={{ opacity: 0.82 }}>
            {subtitle ?? tr('onboarding.subtitle')}
          </Text>
        </View>

        <View style={{ gap: t.spacing(3) }}>
          {note ? (
            <Text variant="body" color="onBrand" style={{ opacity: 0.72 }}>{note}</Text>
          ) : null}
          {allowSignUp ? (
            <>
              <Button title={tr('onboarding.getStarted')} onPress={() => router.push({ pathname: '/(auth)/phone', params: { mode: 'register' } })} />
              <Button title={tr('onboarding.haveAccount')} variant="ghost" onPress={() => router.push({ pathname: '/(auth)/phone', params: { mode: 'login' } })} />
            </>
          ) : (
            <Button title={tr('auth.signIn')} onPress={() => router.push({ pathname: '/(auth)/phone', params: { mode: 'login' } })} />
          )}
        </View>
      </View>
    </Screen>
  );
}
