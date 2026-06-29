import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Text } from './Text';

export type ToastTone = 'success' | 'error' | 'info';
interface ToastState { message: string; tone: ToastTone }

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  success: (m: string) => void;
  error: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
    }, 2600);
  }, [opacity]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const api: ToastApi = {
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', left: t.spacing(4), right: t.spacing(4), top: insets.top + t.spacing(2), opacity }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing(3), backgroundColor: toneColor(t, toast.tone), borderRadius: t.radius.md, paddingHorizontal: t.spacing(4), paddingVertical: t.spacing(3.5), ...t.shadow.floating }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' }} />
            <Text variant="label" style={{ color: '#FFFFFF', flex: 1 }}>{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a <ToastProvider>');
  return ctx;
}

function toneColor(t: Theme, tone: ToastTone): string {
  return tone === 'success' ? t.colors.success : tone === 'error' ? t.colors.danger : t.colors.brand;
}
