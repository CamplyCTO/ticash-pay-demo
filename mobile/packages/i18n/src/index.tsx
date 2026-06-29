import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { dictionaries, type Dictionary, type Locale } from './strings';

export * from './strings';

/** Dot-paths to string leaves of the dictionary, e.g. "auth.codeTitle". */
type Paths<T> = T extends string
  ? ''
  : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string];
export type TKey = Paths<Dictionary>;

export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

function resolve(dict: Dictionary, key: string): string {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key; // missing key -> echo the key (visible in dev)
    }
  }
  return typeof node === 'string' ? node : key;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function I18nProvider({ children, initial = 'pt' }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initial);
  const t = useCallback<Translate>((key, vars) => interpolate(resolve(dictionaries[locale], key), vars), [locale]);
  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an <I18nProvider>');
  return ctx;
}
