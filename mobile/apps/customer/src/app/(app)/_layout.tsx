import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '@ticash/core';
import { useTheme } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';

export default function AppLayout() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { status } = useSession();
  if (status === 'unauthenticated') return <Redirect href="/(auth)/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.tabActive,
        tabBarInactiveTintColor: t.colors.tabInactive,
        tabBarStyle: { backgroundColor: t.colors.tabBar, borderTopColor: t.colors.divider, height: 60, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: tr('tabs.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="send" options={{ title: tr('tabs.send'), tabBarIcon: ({ color, size }) => <Ionicons name="paper-plane-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="activity" options={{ title: tr('tabs.activity'), tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: tr('tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
