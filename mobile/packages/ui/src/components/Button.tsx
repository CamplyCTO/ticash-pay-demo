import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Button({ title, onPress, variant = 'primary', size = 'md', disabled, loading, fullWidth = true, left, right, style, accessibilityLabel }: ButtonProps) {
  const t = useTheme();
  const isDisabled = disabled || loading;
  const v = resolveVariant(t, variant);
  const height = size === 'lg' ? 56 : size === 'sm' ? 40 : 48;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [
        {
          height,
          borderRadius: t.radius.md,
          backgroundColor: v.bg,
          borderWidth: v.borderWidth,
          borderColor: v.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: t.spacing(2),
          paddingHorizontal: t.spacing(5),
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.98 : 1 }],
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {left ? <View>{left}</View> : null}
          <Text variant="label" weight="semibold" style={{ color: v.fg, fontSize: size === 'sm' ? t.font.size.sm : t.font.size.md }}>
            {title}
          </Text>
          {right ? <View>{right}</View> : null}
        </>
      )}
    </Pressable>
  );
}

function resolveVariant(t: Theme, variant: ButtonVariant): { bg: string; fg: string; border: string; borderWidth: number } {
  switch (variant) {
    case 'primary':
      return { bg: t.colors.primary, fg: t.colors.onPrimary, border: 'transparent', borderWidth: 0 };
    case 'danger':
      return { bg: t.colors.danger, fg: '#FFFFFF', border: 'transparent', borderWidth: 0 };
    case 'secondary':
      return { bg: t.colors.surface, fg: t.colors.text, border: t.colors.border, borderWidth: 1 };
    case 'ghost':
      return { bg: 'transparent', fg: t.colors.primary, border: 'transparent', borderWidth: 0 };
  }
}
