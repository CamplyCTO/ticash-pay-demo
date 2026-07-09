import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Input, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';
import { messageForError, useAuthStore } from '@ticash/core';

export function LoginScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const loginPassword = useAuthStore((s) => s.loginPassword);

  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const valid = handle.trim().length >= 3 && password.length >= 1;

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    try {
      await loginPassword(handle, password);
      // On success the auth gate redirects into the app.
    } catch (e) {
      toast.error(messageForError(e, tr));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll footer={<Button title={tr('auth.signIn')} loading={loading} disabled={!valid} onPress={submit} />}>
      <Text variant="title" style={{ marginTop: t.spacing(4) }}>{tr('auth.loginTitle')}</Text>
      <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(7) }}>{tr('auth.loginSubtitle')}</Text>

      <Input label={tr('auth.handle')} value={handle} onChangeText={setHandle} autoCapitalize="none" keyboardType="email-address" placeholder={tr('auth.handlePlaceholder')} containerStyle={{ marginBottom: t.spacing(4) }} />
      <Input label={tr('auth.password')} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" returnKeyType="go" onSubmitEditing={submit} />

      <Button title={tr('auth.forgot')} variant="ghost" onPress={() => router.push('/(auth)/reset')} style={{ marginTop: t.spacing(4) }} />
      <Button title={tr('auth.createAccount')} variant="secondary" onPress={() => router.replace('/(auth)/signup')} style={{ marginTop: t.spacing(2) }} />
    </Screen>
  );
}
