/**
 * Runtime config. The API base URL comes from an Expo public env var
 * (EXPO_PUBLIC_API_URL, inlined at build) and falls back to the live deployment so
 * the apps work out of the box on a real device.
 */
export const API_BASE_URL: string =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL) || 'https://ticash-pay-demo.onrender.com';

/**
 * USDT buy/sell surface (P2P marketplace + deposit). Hidden in the v1 store build
 * to avoid Google Play's crypto-trading policy friction; the backend feature stays
 * fully built and live. Re-enable for v2 with EXPO_PUBLIC_FEATURE_USDT=1 (a one-line
 * flip in eas.json env) — the tab, route, and home action all reappear.
 */
export const FEATURE_USDT: boolean =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_FEATURE_USDT === '1';
