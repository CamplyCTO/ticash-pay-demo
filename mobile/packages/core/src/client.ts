import { TicashApi } from '@ticash/api-client';
import { API_BASE_URL } from './config';

// The access token lives in the auth store; the store registers a getter here so
// the client can attach it without a circular import.
let tokenGetter: () => string | null = () => null;
export function setTokenGetter(fn: () => string | null): void {
  tokenGetter = fn;
}

export const api = new TicashApi({ baseUrl: API_BASE_URL, getAccessToken: () => tokenGetter() });
