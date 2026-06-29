import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { useSession } from '@ticash/core';

export default function AuthLayout() {
  const { status } = useSession();
  if (status === 'authenticated') return <Redirect href="/(app)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
