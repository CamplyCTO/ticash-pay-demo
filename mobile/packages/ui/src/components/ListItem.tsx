import React, { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  /** Trailing emphasised value (e.g. an amount). */
  value?: string;
  valueTone?: 'default' | 'success' | 'danger';
  onPress?: () => void;
  divider?: boolean;
}

export function ListItem({ title, subtitle, left, right, value, valueTone = 'default', onPress, divider = true }: ListItemProps) {
  const t = useTheme();
  const valueColor = valueTone === 'success' ? t.colors.success : valueTone === 'danger' ? t.colors.danger : t.colors.text;
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing(3),
        paddingVertical: t.spacing(3.5),
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: t.colors.divider,
      }}
    >
      {left ? <View>{left}</View> : null}
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="medium" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="caption" color="textMuted" numberOfLines={1} style={{ marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {value ? <Text variant="body" weight="semibold" style={{ color: valueColor }}>{value}</Text> : null}
      {right}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  ) : body;
}
