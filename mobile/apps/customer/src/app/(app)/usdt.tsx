import { Redirect } from 'expo-router';
import { FEATURE_USDT } from '@ticash/core';
import { UsdtScreen } from '@/features/UsdtScreen';

// v1 store build hides USDT (Google Play crypto policy). Guard the route directly so
// a deep link / direct navigation can't reach buy/sell while the tab is hidden.
export default function UsdtRoute() {
  if (!FEATURE_USDT) return <Redirect href="/(app)" />;
  return <UsdtScreen />;
}
