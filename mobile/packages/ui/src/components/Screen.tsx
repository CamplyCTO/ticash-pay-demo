import React, { type ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: readonly Edge[];
  background?: 'background' | 'surface' | 'brand';
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  footer?: ReactNode;
}

/** Standard screen frame: safe-area aware, themed background, optional scroll + sticky footer. */
export function Screen({ children, scroll = false, padded = true, edges = ['top', 'bottom'], background = 'background', style, contentStyle, footer }: ScreenProps) {
  const t = useTheme();
  const pad: ViewStyle = padded ? { paddingHorizontal: t.spacing(5), paddingTop: t.spacing(4) } : {};
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ paddingBottom: t.spacing(8), flexGrow: 1 }, pad, contentStyle]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: t.colors[background] }, style]}>
      {body}
      {footer ? <View style={{ paddingHorizontal: t.spacing(5), paddingTop: t.spacing(3), paddingBottom: t.spacing(2) }}>{footer}</View> : null}
    </SafeAreaView>
  );
}
