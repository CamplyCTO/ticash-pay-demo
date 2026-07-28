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
  /** Max content width. On wide viewports (desktop web / tablet) the content is
   *  centered in this column instead of stretching edge-to-edge. Phones are narrower
   *  than this, so there's no visual change on mobile. */
  maxWidth?: number;
}

/** Keeps the app a centered, readable column on large screens (RNW web / tablets). */
const DEFAULT_MAX_WIDTH = 520;

/** Standard screen frame: safe-area aware, themed background, optional scroll + sticky footer. */
export function Screen({ children, scroll = false, padded = true, edges = ['top', 'bottom'], background = 'background', style, contentStyle, footer, maxWidth = DEFAULT_MAX_WIDTH }: ScreenProps) {
  const t = useTheme();
  const pad: ViewStyle = padded ? { paddingHorizontal: t.spacing(5), paddingTop: t.spacing(4) } : {};
  // Center the content in a max-width column on wide screens; full-width on phones.
  const column: ViewStyle = { width: '100%', maxWidth, alignSelf: 'center' };
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ paddingBottom: t.spacing(8), flexGrow: 1 }, column, pad, contentStyle]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, column, pad, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: t.colors[background] }, style]}>
      {body}
      {footer ? (
        <View style={[{ paddingHorizontal: t.spacing(5), paddingTop: t.spacing(3), paddingBottom: t.spacing(2) }, column]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}
