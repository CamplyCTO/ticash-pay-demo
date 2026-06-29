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
      <Tabs.Screen name="index" options={{ title: tr('tabs.cashier'), tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="float" options={{ title: tr('tabs.float'), tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="activity" options={{ title: tr('tabs.activity'), tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: tr('tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
      {/* Cash-in/out flow: navigable via router.push, hidden from the tab bar. */}
      <Tabs.Screen name="cash" options={{ href: null }} />
    </Tabs>
  );
}
