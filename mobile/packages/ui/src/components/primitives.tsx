import React, { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Ticash wordmark: "ti" in brand text + "cash" in emerald. */
export function Logo({ size = 28, onBrand = false }: { size?: number; onBrand?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityRole="header" accessibilityLabel="Ticash Pay">
      <Text style={{ fontSize: size, fontWeight: t.font.weight.bold, color: onBrand ? t.colors.onBrand : t.colors.text }}>ti</Text>
      <Text style={{ fontSize: size, fontWeight: t.font.weight.bold, color: t.colors.primary }}>cash</Text>
      <View style={{ width: size * 0.18, height: size * 0.18, borderRadius: size, backgroundColor: t.colors.accent, marginLeft: 3, marginTop: size * 0.3 }} />
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const t = useTheme();
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: t.radius.pill, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text weight="bold" style={{ color: t.colors.primary, fontSize: size * 0.4 }}>{initials}</Text>
    </View>
  );
}

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function Chip({ label, tone = 'neutral', style }: { label: string; tone?: ChipTone; style?: ViewStyle }) {
  const t = useTheme();
  const map: Record<ChipTone, string> = {
    neutral: t.colors.textMuted,
    success: t.colors.success,
    warning: t.colors.warning,
    danger: t.colors.danger,
    info: t.colors.info,
  };
  const c = map[tone];
  return (
    <View style={[{ alignSelf: 'flex-start', paddingHorizontal: t.spacing(2.5), paddingVertical: t.spacing(1), borderRadius: t.radius.pill, backgroundColor: c + '22' }, style]}>
      <Text variant="caption" weight="semibold" style={{ color: c }}>{label}</Text>
    </View>
  );
}

export function Divider({ spacing = 0 }: { spacing?: number }) {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.colors.divider, marginVertical: t.spacing(spacing) }} />;
}

export function Row({ children, gap = 2, align = 'center', style }: { children: ReactNode; gap?: number; align?: ViewStyle['alignItems']; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ flexDirection: 'row', alignItems: align, gap: t.spacing(gap) }, style]}>{children}</View>;
}
