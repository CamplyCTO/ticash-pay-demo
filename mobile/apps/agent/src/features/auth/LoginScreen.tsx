import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Input, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';
import { messageForError, useAuthStore } from '@ticash/core';

/**
 * Agent login: phone + password. Agents are admin-provisioned WITHOUT a password, so a
 * first-time agent taps "first access / forgot" to set one via a one-time SMS code (the
 * reset flow). After that they sign in with the password — no SMS per login, which keeps
 * SMS cost down (the client's explicit requirement; customers keep password + SMS as-is).
 */
export function LoginScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const loginPassword = useAuthStore((s) => s.loginPassword);

  const [handle, setHandle] = useState('+55');
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

      <Input
        label={tr('auth.phoneLabel')}
        value={handle}
        onChangeText={setHandle}
        autoCapitalize="none"
        keyboardType="phone-pad"
        placeholder="+55 11 99999-9999"
        containerStyle={{ marginBottom: t.spacing(4) }}
      />
      <Input
        label={tr('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="••••••••"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {/* First-time agents have no password yet; this same flow also handles a forgot-reset. */}
      <Button title={tr('auth.firstAccess')} variant="ghost" onPress={() => router.push('/(auth)/reset')} style={{ marginTop: t.spacing(4) }} />
    </Screen>
  );
}
