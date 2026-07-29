import React, { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Input, Screen, Text, useToast, useTheme } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';
import { useAuthStore } from '../auth-store';
import { messageForError } from '../errors';

/** `forceMode` overrides the URL `mode` param — the agent app pins it to 'login' so an
 *  agent can never be driven into self-registration (agents are admin-provisioned). */
export function PhoneScreen({ forceMode }: { forceMode?: 'login' | 'register' } = {}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode = forceMode ?? modeParam;
  const startOtp = useAuthStore((s) => s.startOtp);
  const [phone, setPhone] = useState('+55');
  const [loading, setLoading] = useState(false);

  const valid = phone.replace(/\D/g, '').length >= 8;

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    try {
      await startOtp(phone.trim(), { register: mode !== 'login' });
      router.push({ pathname: '/(auth)/otp', params: { phone: phone.trim(), mode: mode ?? 'register' } });
    } catch (e) {
      toast.error(messageForError(e, tr));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen footer={<Button title={tr('auth.sendCode')} loading={loading} disabled={!valid} onPress={submit} />}>
      <Text variant="title" style={{ marginTop: t.spacing(4) }}>{tr('auth.phoneTitle')}</Text>
      <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(7) }}>{tr('auth.phoneSubtitle')}</Text>
      <Input
        label={tr('auth.phoneLabel')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoFocus
        placeholder="+55 11 99999-9999"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
    </Screen>
  );
}
