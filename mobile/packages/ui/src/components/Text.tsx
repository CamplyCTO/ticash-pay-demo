import React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeColors } from '../theme/tokens';

export type TextVariant = 'display' | 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption';
export type TextColor = keyof Pick<ThemeColors, 'text' | 'textMuted' | 'textInverse' | 'primary' | 'accent' | 'danger' | 'success' | 'onBrand' | 'onPrimary'>;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  center?: boolean;
}

export function Text({ variant = 'body', color = 'text', weight, center, style, ...rest }: TextProps) {
  const t = useTheme();
  const v = VARIANTS[variant];
  return (
    <RNText
      {...rest}
      style={[
        {
          color: t.colors[color],
          fontSize: t.font.size[v.size],
          fontWeight: t.font.weight[weight ?? v.weight],
          lineHeight: t.font.size[v.size] * v.lh,
        },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}

const VARIANTS: Record<TextVariant, { size: keyof ReturnType<typeof sizeKeys>; weight: 'regular' | 'medium' | 'semibold' | 'bold'; lh: number }> = {
  display: { size: 'display', weight: 'bold', lh: 1.15 },
  title: { size: 'xxl', weight: 'bold', lh: 1.2 },
  heading: { size: 'xl', weight: 'semibold', lh: 1.25 },
  subheading: { size: 'lg', weight: 'semibold', lh: 1.3 },
  body: { size: 'md', weight: 'regular', lh: 1.4 },
  label: { size: 'sm', weight: 'medium', lh: 1.3 },
  caption: { size: 'xs', weight: 'regular', lh: 1.3 },
};

// Helper purely for the keyof type above.
function sizeKeys() {
  return { xs: 0, sm: 0, md: 0, lg: 0, xl: 0, xxl: 0, display: 0 };
}
