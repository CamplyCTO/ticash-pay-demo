import { ApiError } from '@ticash/api-client';
import type { Translate } from '@ticash/i18n';

/** Map an API error to a localized, user-facing message. */
export function messageForError(e: unknown, t: Translate): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'INVALID_OTP':
        return t('auth.invalidCode');
      case 'RATE_LIMITED':
        return t('auth.rateLimited');
      case 'NETWORK':
        return t('common.error');
      default:
        return e.message || t('common.error');
    }
  }
  return t('common.error');
}
