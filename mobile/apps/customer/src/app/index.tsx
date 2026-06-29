import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '@ticash/core';
import { Logo, useTheme } from '@ticash/ui';

export default function Index() {
  const t = useTheme();
  const { status } = useSession();
  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.brand, gap: t.spacing(6) }}>
        <Logo size={40} onBrand />
        <ActivityIndicator color={t.colors.onBrand} />
      </View>
    );
  }
  return <Redirect href={status === 'authenticated' ? '/(app)' : '/(auth)/onboarding'} />;
}
