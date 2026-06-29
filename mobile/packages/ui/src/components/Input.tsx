import React, { forwardRef, type ReactNode, useState } from 'react';
import { TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  hint?: string;
  left?: ReactNode;
  right?: ReactNode;
  containerStyle?: ViewStyle;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, left, right, containerStyle, onFocus, onBlur, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? t.colors.danger : focused ? t.colors.primary : t.colors.border;
  return (
    <View style={[{ gap: t.spacing(1.5) }, containerStyle]}>
      {label ? <Text variant="label" color="textMuted">{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing(2),
          minHeight: 52,
          paddingHorizontal: t.spacing(4),
          borderRadius: t.radius.md,
          borderWidth: 1.5,
          borderColor,
          backgroundColor: t.colors.surface,
        }}
      >
        {left}
        <TextInput
          ref={ref}
          placeholderTextColor={t.colors.textMuted}
          selectionColor={t.colors.primary}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={{ flex: 1, color: t.colors.text, fontSize: t.font.size.md, paddingVertical: t.spacing(3) }}
          {...rest}
        />
        {right}
      </View>
      {error ? (
        <Text variant="caption" color="danger">{error}</Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">{hint}</Text>
      ) : null}
    </View>
  );
});
