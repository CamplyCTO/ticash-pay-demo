import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Secure token storage. Uses the Keychain/Keystore via expo-secure-store on
 * native; falls back to localStorage on web (SecureStore is native-only).
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try { globalThis.localStorage?.setItem(key, value); } catch { /* ignore */ }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const STORAGE_KEYS = {
  refreshToken: 'ticash.refreshToken',
  locale: 'ticash.locale',
} as const;
