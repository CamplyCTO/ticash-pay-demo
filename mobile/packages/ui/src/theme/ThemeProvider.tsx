import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, type Theme } from './tokens';

export type ColorSchemePreference = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  preference: ColorSchemePreference;
  setPreference: (p: ColorSchemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initial = 'system' }: { children: ReactNode; initial?: ColorSchemePreference }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState<ColorSchemePreference>(initial);
  const value = useMemo<ThemeContextValue>(() => {
    const effective = preference === 'system' ? (system ?? 'light') : preference;
    return { theme: effective === 'dark' ? darkTheme : lightTheme, preference, setPreference };
  }, [preference, system]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a <ThemeProvider>');
  return ctx.theme;
}

export function useThemePreference(): Pick<ThemeContextValue, 'preference' | 'setPreference'> {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemePreference must be used within a <ThemeProvider>');
  return { preference: ctx.preference, setPreference: ctx.setPreference };
}
