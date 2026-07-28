import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Button, Input, Screen, Text, useToast, useTheme } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';
import { useAuthStore } from '../auth-store';
import { messageForError } from '../errors';

export function OtpScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const { phone = '', mode } = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const verify = useAuthStore((s) => s.verify);
  const startOtp = useAuthStore((s) => s.startOtp);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const valid = code.replace(/\D/g, '').length >= 4;

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    try {
      await verify(String(phone), code.trim());
      // On success the root layout's gate redirects into the app.
    } catch (e) {
      toast.error(messageForError(e, tr));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      await startOtp(String(phone), { register: mode !== 'login' });
      toast.success(tr('auth.resend'));
    } catch (e) {
      toast.error(messageForError(e, tr));
    }
  };

  return (
    <Screen footer={<Button title={tr('auth.verify')} loading={loading} disabled={!valid} onPress={submit} />}>
      <Text variant="title" style={{ marginTop: t.spacing(4) }}>{tr('auth.codeTitle')}</Text>
      <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(7) }}>
        {tr('auth.codeSubtitle', { phone: String(phone) })}
      </Text>
      <Input
        label={tr('auth.codeLabel')}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoFocus
        placeholder="000000"
        maxLength={6}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Button title={tr('auth.resend')} variant="ghost" onPress={resend} style={{ marginTop: t.spacing(4) }} />
    </Screen>
  );
}
