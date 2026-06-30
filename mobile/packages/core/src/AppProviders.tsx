import React, { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
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
