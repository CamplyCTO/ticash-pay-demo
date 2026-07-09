import React, { useState } from 'react';
import { Button, Input, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';
import { messageForError, useAuthStore } from '@ticash/core';

export function ResetScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const requestReset = useAuthStore((s) => s.requestReset);
  const resetPassword = useAuthStore((s) => s.resetPassword);

  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [phone, setPhone] = useState('+55');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const phoneValid = phone.replace(/\D/g, '').length >= 8;
  const resetValid = code.replace(/\D/g, '').length >= 4 && newPassword.length >= 6;

  const onRequest = async () => {
    if (!phoneValid || loading) return;
    setLoading(true);
    try {
      await requestReset(phone.trim());
      setStep('reset');
      toast.success(tr('auth.codeSent'));
    } catch (e) {
      toast.error(messageForError(e, tr));
    } finally {
      setLoading(false);
    }
  };

  const onReset = async () => {
    if (!resetValid || loading) return;
    setLoading(true);
    try {
      await resetPassword(phone.trim(), code.trim(), newPassword);
      // On success the auth gate redirects into the app.
    } catch (e) {
      toast.error(messageForError(e, tr));
    } finally {
      setLoading(false);
    }
  };

  if (step === 'reset') {
    return (
      <Screen scroll footer={<Button title={tr('auth.resetPassword')} loading={loading} disabled={!resetValid} onPress={onReset} />}>
        <Text variant="title" style={{ marginTop: t.spacing(4) }}>{tr('auth.resetTitle')}</Text>
        <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(7) }}>{tr('auth.codeSubtitle', { phone: phone.trim() })}</Text>
        <Input label={tr('auth.codeLabel')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="000000" maxLength={6} containerStyle={{ marginBottom: t.spacing(4) }} />
        <Input label={tr('auth.newPassword')} value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder={tr('auth.passwordHint')} />
      </Screen>
    );
  }

  return (
    <Screen scroll footer={<Button title={tr('auth.sendCode')} loading={loading} disabled={!phoneValid} onPress={onRequest} />}>
      <Text variant="title" style={{ marginTop: t.spacing(4) }}>{tr('auth.forgot')}</Text>
      <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(7) }}>{tr('auth.forgotSubtitle')}</Text>
      <Input label={tr('auth.phoneLabel')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+55 11 99999-9999" />
    </Screen>
  );
}
