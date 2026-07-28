import { Platform } from 'react-native';
import { TicashApi } from '@ticash/api-client';
import { API_BASE_URL } from './config';

const isWeb = Platform.OS === 'web';
/** Read the readable double-submit CSRF token the backend set (web cookie session). */
function readCsrfCookie(): string | null {
  if (!isWeb || typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)ticash_csrf=([^;]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

// The access token lives in the auth store; the store registers a getter here so
// the client can attach it without a circular import.
let tokenGetter: () => string | null = () => null;
export function setTokenGetter(fn: () => string | null): void {
  tokenGetter = fn;
}

// On a 401, the client asks the store to silently refresh + replay. Injected the
// same way to avoid a circular import (store imports client, not vice versa).
let unauthorizedHandler: () => Promise<boolean> = async () => false;
export function setUnauthorizedHandler(fn: () => Promise<boolean>): void {
  unauthorizedHandler = fn;
}

export const api = new TicashApi({
  baseUrl: API_BASE_URL,
  getAccessToken: () => tokenGetter(),
  onUnauthorized: () => unauthorizedHandler(),
  // Web uses the cookie session: send the session cookie + echo the CSRF token on refresh.
  withCredentials: isWeb,
  getCsrfToken: readCsrfCookie,
});
