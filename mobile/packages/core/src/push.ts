import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { api } from './client';
import { useAuthStore } from './auth-store';

// Show the alert + play a sound even when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Request permission + return this device's Expo push token (native only). */
async function acquireToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null; // Expo push tokens are native-only
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return res.data;
}

/**
 * Registers this device for push once the user is authenticated, and deep-links
 * when a notification is tapped. Best-effort — push is optional and never blocks
 * the app; on web it is a no-op.
 */
export function usePushNotifications(): void {
  const status = useAuthStore((s) => s.status);
  const router = useRouter();
  const registered = useRef(false);

  useEffect(() => {
    // Reset on logout so a re-login (possibly a DIFFERENT user on the same device)
    // re-registers — the server upsert reassigns the token to the new user.
    if (status !== 'authenticated') {
      registered.current = false;
      return;
    }
    if (registered.current) return;
    void (async () => {
      try {
        const token = await acquireToken();
        if (!token) return;
        registered.current = true;
        await api.registerPush(token, Platform.OS);
      } catch {
        /* push is optional */
      }
    })();
  }, [status]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const screen = resp.notification.request.content.data?.screen;
      if (typeof screen === 'string') router.push(screen);
    });
    return () => sub.remove();
  }, [router]);
}

/** Invisible component that activates push registration; mount inside the app tree. */
export function PushBridge(): null {
  usePushNotifications();
  return null;
}
