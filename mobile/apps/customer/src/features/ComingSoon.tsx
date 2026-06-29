import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, Screen, Text, useTheme } from '@ticash/ui';

export function ComingSoon({ title, icon }: { title: string; icon: keyof typeof Ionicons.glyphMap }) {
  const t = useTheme();
  return (
    <Screen>
      <Text variant="title" style={{ marginTop: t.spacing(4), marginBottom: t.spacing(6) }}>{title}</Text>
      <EmptyState
        title="Coming soon"
        message="This flow lands in the next milestone."
        icon={<Ionicons name={icon} size={28} color={t.colors.primary} />}
      />
    </Screen>
  );
}
