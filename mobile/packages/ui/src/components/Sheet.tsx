import React, { type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Bottom sheet over a dimmed scrim. Tapping the scrim closes it. */
export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: t.colors.overlay, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            paddingHorizontal: t.spacing(5),
            paddingTop: t.spacing(3),
            paddingBottom: insets.bottom + t.spacing(5),
            ...t.shadow.floating,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.border, marginBottom: t.spacing(4) }} />
          {title ? <Text variant="heading" style={{ marginBottom: t.spacing(3) }}>{title}</Text> : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
