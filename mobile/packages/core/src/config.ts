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

/**
 * Airtime ("Recarga") top-up. Hidden in v1 until the DingConnect provider is
 * provisioned (API key + whitelisted static IP) — otherwise the screen shows
 * "no products available", which reads as broken to users and Play reviewers.
 * Flip on with EXPO_PUBLIC_FEATURE_AIRTIME=1 once DingConnect is live.
 */
export const FEATURE_AIRTIME: boolean =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_FEATURE_AIRTIME === '1';
