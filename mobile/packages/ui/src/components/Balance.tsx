import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface BalanceProps {
  /** Currency code, e.g. BRL / HTG / USDT. */
  code: string;
  /** Display symbol, e.g. R$. */
  symbol: string;
  /** Integer part incl. grouping, e.g. "1.240". */
  integer: string;
  /** Fractional part, e.g. "00". */
  fraction: string;
  label?: string;
  size?: 'lg' | 'md' | 'sm';
  onBrand?: boolean;
}

/** The hero money display: large integer, smaller fraction, currency code chip. */
export function Balance({ code, symbol, integer, fraction, label, size = 'lg', onBrand = false }: BalanceProps) {
  const t = useTheme();
  const big = size === 'lg' ? t.font.size.display : size === 'md' ? t.font.size.xxl : t.font.size.xl;
  const textColor = onBrand ? t.colors.onBrand : t.colors.text;
  const mutedColor = onBrand ? t.colors.onBrand : t.colors.textMuted;
  return (
    <View>
      {label ? <Text variant="label" style={{ color: mutedColor, opacity: 0.8, marginBottom: t.spacing(1) }}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text style={{ color: mutedColor, fontSize: big * 0.55, fontWeight: t.font.weight.semibold, marginRight: t.spacing(1), marginBottom: big * 0.12 }}>
          {symbol}
        </Text>
        <Text style={{ color: textColor, fontSize: big, fontWeight: t.font.weight.bold, lineHeight: big * 1.05 }}>
          {integer}
        </Text>
        <Text style={{ color: mutedColor, fontSize: big * 0.5, fontWeight: t.font.weight.semibold, marginBottom: big * 0.14 }}>
          {fraction ? `,${fraction}` : ''}
        </Text>
        <View style={{ marginLeft: t.spacing(2), marginBottom: big * 0.16, paddingHorizontal: t.spacing(2), paddingVertical: 2, borderRadius: t.radius.pill, backgroundColor: onBrand ? 'rgba(255,255,255,0.16)' : t.colors.primarySoft }}>
          <Text variant="caption" weight="bold" style={{ color: onBrand ? t.colors.onBrand : t.colors.primary }}>{code}</Text>
        </View>
      </View>
    </View>
  );
}
