import React, { type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, message, icon, action }: EmptyStateProps) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: t.spacing(12), paddingHorizontal: t.spacing(6), gap: t.spacing(3) }}>
      {icon ? (
        <View style={{ width: 72, height: 72, borderRadius: t.radius.pill, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </View>
      ) : null}
      <Text variant="subheading" center>{title}</Text>
      {message ? <Text variant="body" color="textMuted" center>{message}</Text> : null}
      {action ? <View style={{ marginTop: t.spacing(2) }}>{action}</View> : null}
    </View>
  );
}
