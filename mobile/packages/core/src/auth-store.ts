import { create } from 'zustand';
import { ApiError, type AuthTokens, type PublicUser } from '@ticash/api-client';
import { api, setTokenGetter } from './client';
import { secureStorage, STORAGE_KEYS } from './storage';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  user: PublicUser | null;
  /** Restore a session from the stored refresh token on app launch. */
  bootstrap: () => Promise<void>;
  /** Begin login/signup: trigger an OTP for the phone. `register` self-signs-up. */
  startOtp: (phone: string, opts?: { register?: boolean }) => Promise<void>;
  /** Complete login by verifying the OTP. */
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
    const rt = await secureStorage.get(STORAGE_KEYS.refreshToken);
    if (!rt) {
      set({ status: 'unauthenticated' });
      return;
    }
    try {
      const tokens = await api.refresh(rt);
      await applyTokens(set, tokens);
      set({ status: 'authenticated' });
    } catch {
      await secureStorage.remove(STORAGE_KEYS.refreshToken);
      set({ status: 'unauthenticated', accessToken: null, refreshToken: null, user: null });
    }
  },

  startOtp: async (phone, opts) => {
    if (opts?.register) {
      try {
        await api.register(phone); // self-signup also sends the first OTP
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
    if (!rt) return false;
    try {
      const tokens = await api.refresh(rt);
      await applyTokens(set, tokens);
      return true;
    } catch {
      await get().signOut();
      return false;
    }
  },

  signOut: async () => {
    const rt = get().refreshToken;
    if (rt) {
      try { await api.logout(rt); } catch { /* best effort */ }
    }
    await secureStorage.remove(STORAGE_KEYS.refreshToken);
    set({ status: 'unauthenticated', accessToken: null, refreshToken: null, user: null });
  },
}));

async function applyTokens(set: (partial: Partial<AuthState>) => void, tokens: AuthTokens): Promise<void> {
  await secureStorage.set(STORAGE_KEYS.refreshToken, tokens.refreshToken);
  set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: tokens.user });
}

// Wire the API client's access-token getter to this store.
setTokenGetter(() => useAuthStore.getState().accessToken);
