/** Push notification domain (Expo push tokens + messages). */

export type PushPlatform = 'ios' | 'android' | 'web';

export interface RegisterTokenInput {
  userId: string;
  expoToken: string;
  platform?: PushPlatform | string;
}

/** A user-facing notification; `data` carries a deep-link target for the app. */
export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}
