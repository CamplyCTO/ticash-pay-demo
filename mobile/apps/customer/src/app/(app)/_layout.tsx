import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession, FEATURE_USDT } from '@ticash/core';
import { useTheme } from '@ticash/ui';
import { useI18n } from '@ticash/i18n';

export default function AppLayout() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { status } = useSession();
  const insets = useSafeAreaInsets();
  if (status === 'unauthenticated') return <Redirect href="/(auth)/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.tabActive,
        tabBarInactiveTintColor: t.colors.tabInactive,
        // Add the device's bottom inset so the bar/labels clear the gesture nav bar.
        tabBarStyle: { backgroundColor: t.colors.tabBar, borderTopColor: t.colors.divider, height: 60 + insets.bottom, paddingBottom: insets.bottom + 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: tr('tabs.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="send" options={{ title: tr('tabs.send'), tabBarIcon: ({ color, size }) => <Ionicons name="paper-plane-outline" color={color} size={size} /> }} />
      {/* USDT tab: hidden from the bar in the v1 build (href:null); re-enabled by FEATURE_USDT. */}
      <Tabs.Screen name="usdt" options={{ href: FEATURE_USDT ? undefined : null, title: 'USDT', tabBarIcon: ({ color, size }) => <Ionicons name="logo-usd" color={color} size={size} /> }} />
      <Tabs.Screen name="activity" options={{ title: tr('tabs.activity'), tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: tr('tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
      {/* Navigable via router.push, hidden from the tab bar. */}
      <Tabs.Screen name="receive" options={{ href: null }} />
      <Tabs.Screen name="deposit" options={{ href: null }} />
      <Tabs.Screen name="topup" options={{ href: null }} />
      <Tabs.Screen name="kyc" options={{ href: null }} />
    </Tabs>
  );
}
