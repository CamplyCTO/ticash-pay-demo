/**
 * Runtime config. The API base URL comes from an Expo public env var
 * (EXPO_PUBLIC_API_URL, inlined at build) and falls back to the live deployment so
 * the apps work out of the box on a real device.
 */
export const API_BASE_URL: string =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL) || 'https://ticash-pay-demo.onrender.com';
