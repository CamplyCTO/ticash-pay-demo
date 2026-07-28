import { Platform } from 'react-native';
import { create } from 'zustand';
import { ApiError, type AuthTokens, type PublicUser } from '@ticash/api-client';
import { api, setTokenGetter, setUnauthorizedHandler } from './client';
import { secureStorage, STORAGE_KEYS } from './storage';

/** The web app uses the httpOnly-cookie session (the refresh token never touches JS);
 *  native uses the bearer/SecureStore flow. Keyed purely on the platform so it can't be
 *  affected by build-env/prerender quirks. */
const webCookieSession = Platform.OS === 'web';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  user: PublicUser | null;
  /** Restore a session from the stored refresh token on app launch. */
  bootstrap: () => Promise<void>;
  /** Customer signup with profile + password; an OTP then verifies the phone. */
  signUp: (input: { name: string; phone: string; country: string; email?: string; password: string }) => Promise<void>;
  /** Password login by email OR phone (no OTP). */
  loginPassword: (handle: string, password: string) => Promise<void>;
  /** Forgot password: send an OTP to the account's phone. */
  requestReset: (handle: string) => Promise<void>;
  /** Complete a reset (phone + OTP + new password) — logs in. */
  resetPassword: (phone: string, code: string, newPassword: string) => Promise<void>;
  /** Agent OTP login (agents are admin-provisioned, no password). */
  startOtp: (phone: string, opts?: { register?: boolean }) => Promise<void>;
  /** Complete an OTP login/verification (agent login + customer phone-verify). */
  verify: (phone: string, code: string) => Promise<void>;
  /** Force a token refresh; signs out on failure. */
  refresh: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  accessToken: null,
  refreshToken: null,
  user: null,

  bootstrap: async () => {
    // Native/bearer reads the stored token; the web cookie session provides it via
    // the httpOnly cookie (api.refresh() with no argument).
    const rt = webCookieSession ? null : await secureStorage.get(STORAGE_KEYS.refreshToken);
    if (!rt && !webCookieSession) {
      set({ status: 'unauthenticated' });
      return;
    }
    try {
      const tokens = rt ? await api.refresh(rt) : await api.refresh();
      await applyTokens(set, tokens);
      set({ status: 'authenticated' });
    } catch {
      if (rt) await secureStorage.remove(STORAGE_KEYS.refreshToken);
      set({ status: 'unauthenticated', accessToken: null, refreshToken: null, user: null });
    }
  },

  signUp: async ({ name, phone, country, email, password }) => {
    // Creates the account + sends a phone-verification OTP. Session starts after verify.
    await api.register({ name, phone, country, password, ...(email ? { email } : {}) });
  },

  loginPassword: async (handle, password) => {
    const tokens = await api.login(handle.trim(), password);
    await applyTokens(set, tokens);
    set({ status: 'authenticated' });
  },

  requestReset: async (handle) => {
    await api.requestPasswordReset(handle.trim());
  },

  resetPassword: async (phone, code, newPassword) => {
    const tokens = await api.resetPassword(phone, code, newPassword);
    await applyTokens(set, tokens);
    set({ status: 'authenticated' });
  },

  startOtp: async (phone, opts) => {
    if (opts?.register) {
      try {
        await api.register({ phone }); // agent flow: self-signup also sends the first OTP
        return;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONFLICT') {
          await api.requestOtp(phone); // already registered -> just log in
          return;
        }
        throw e;
      }
    }
    await api.requestOtp(phone);
  },

  verify: async (phone, code) => {
    const tokens = await api.verify(phone, code);
    await applyTokens(set, tokens);
    set({ status: 'authenticated' });
  },

  refresh: async () => {
    const rt = get().refreshToken;
    if (!rt && !webCookieSession) return false;
    try {
      const tokens = rt ? await api.refresh(rt) : await api.refresh();
      await applyTokens(set, tokens);
      return true;
    } catch {
      await get().signOut();
      return false;
    }
  },

  signOut: async () => {
    const rt = get().refreshToken;
    // Body token (native) or the cookie (web) — both revoke server-side + clear the cookie.
    try { await api.logout(rt ?? undefined); } catch { /* best effort */ }
    await secureStorage.remove(STORAGE_KEYS.refreshToken);
    set({ status: 'unauthenticated', accessToken: null, refreshToken: null, user: null });
  },
}));

async function applyTokens(set: (partial: Partial<AuthState>) => void, tokens: AuthTokens): Promise<void> {
  if (webCookieSession) {
    // Cookie mode: the refresh token lives ONLY in the httpOnly cookie — never in JS
    // (neither localStorage NOR the in-memory store), so XSS can't exfiltrate it.
    set({ accessToken: tokens.accessToken, refreshToken: null, user: tokens.user });
    return;
  }
  await secureStorage.set(STORAGE_KEYS.refreshToken, tokens.refreshToken);
  set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: tokens.user });
}

// Wire the API client's access-token getter to this store.
setTokenGetter(() => useAuthStore.getState().accessToken);
// Wire the client's 401 → silent-refresh handler. `refresh()` updates the access
// token on success (the request is then replayed) and signs out on failure.
setUnauthorizedHandler(() => useAuthStore.getState().refresh());
