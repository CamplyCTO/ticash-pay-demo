import React, { useEffect, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider } from '@ticash/i18n';
import { ThemeProvider, ToastProvider } from '@ticash/ui';
import { queryClient } from './query';
import { useAuthStore } from './auth-store';
import { PushBridge } from './push';

/** All app-wide providers + one-time session bootstrap. Wrap the root layout. */
export function AppProviders({ children }: { children: ReactNode }) {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Wire React Native AppState into React Query's focus manager so queries with
  // refetchOnWindowFocus refresh when the app returns to the foreground (no re-login).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider initial="system">
          <I18nProvider initial="pt">
            <ToastProvider>
              <PushBridge />
              {children}
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
