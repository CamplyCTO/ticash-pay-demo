import React, { type ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  elevated?: boolean;
  padded?: boolean;
  style?: ViewStyle;
}

export function Card({ children, onPress, elevated = false, padded = true, style }: CardProps) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: elevated ? t.colors.cardElevated : t.colors.card,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: padded ? t.spacing(4) : 0,
    ...(elevated ? t.shadow.card : null),
  };
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}
