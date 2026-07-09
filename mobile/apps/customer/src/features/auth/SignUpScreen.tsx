import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Input, Row, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';
import { messageForError, useAuthStore } from '@ticash/core';
import { COUNTRIES } from './countries';

export function SignUpScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const signUp = useAuthStore((s) => s.signUp);

  const [name, setName] = useState('');
  const [country, setCountry] = useState('BR');
  const [phone, setPhone] = useState('+55');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const pickCountry = (code: string) => {
    setCountry(code);
    const dial = COUNTRIES.find((c) => c.code === code)?.dial ?? '';
    // Reset the phone prefix to the country's dial code if it's still just a prefix.
    if (phone.replace(/\D/g, '').length <= 4) setPhone(dial);
  };

  const phoneDigits = phone.replace(/\D/g, '').length;
  const valid = name.trim().length >= 2 && phoneDigits >= 8 && password.length >= 6 && (!email || /.+@.+\..+/.test(email));

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    try {
      await signUp({ name: name.trim(), phone: phone.trim(), country, password, ...(email.trim() ? { email: email.trim() } : {}) });
      // Account created; verify the phone via OTP next.
      router.push({ pathname: '/(auth)/otp', params: { phone: phone.trim(), mode: 'verify' } });
    } catch (e) {
      toast.error(messageForError(e, tr));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll footer={<Button title={tr('auth.createAccount')} loading={loading} disabled={!valid} onPress={submit} />}>
      <Text variant="title" style={{ marginTop: t.spacing(3) }}>{tr('auth.signupTitle')}</Text>
      <Text variant="body" color="textMuted" style={{ marginTop: t.spacing(2), marginBottom: t.spacing(6) }}>{tr('auth.signupSubtitle')}</Text>

      <Input label={tr('auth.name')} value={name} onChangeText={setName} placeholder={tr('auth.namePlaceholder')} autoCapitalize="words" containerStyle={{ marginBottom: t.spacing(4) }} />

      <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(2) }}>{tr('auth.country')}</Text>
      <Row gap={2} style={{ flexWrap: 'wrap', marginBottom: t.spacing(4) }}>
        {COUNTRIES.map((c) => {
          const active = c.code === country;
          return (
            <Pressable key={c.code} onPress={() => pickCountry(c.code)} style={{ paddingHorizontal: t.spacing(3), paddingVertical: t.spacing(2.5), borderRadius: t.radius.pill, backgroundColor: active ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border }}>
              <Text variant="label" weight="semibold" style={{ color: active ? t.colors.onPrimary : t.colors.text }}>{c.flag} {c.labelPt}</Text>
            </Pressable>
          );
        })}
      </Row>

      <Input label={tr('auth.phoneLabel')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+55 11 99999-9999" containerStyle={{ marginBottom: t.spacing(4) }} />
      <Input label={`${tr('auth.email')} (${tr('common.optional')})`} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="voce@email.com" containerStyle={{ marginBottom: t.spacing(4) }} />
      <Input label={tr('auth.password')} value={password} onChangeText={setPassword} secureTextEntry placeholder={tr('auth.passwordHint')} containerStyle={{ marginBottom: t.spacing(4) }} />

      <Button title={tr('auth.haveAccount')} variant="ghost" onPress={() => router.replace('/(auth)/login')} />
    </Screen>
  );
}
