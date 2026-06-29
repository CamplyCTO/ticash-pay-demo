/**
 * Ticash Pay design tokens. Brand: deep navy chrome + emerald (primary CTA, the
 * colour of money/positive flow) + gold accent. One source of truth for both apps.
 */
import type { TextStyle, ViewStyle } from 'react-native';

export const palette = {
  // Brand
  navy900: '#07121F',
  navy800: '#0B1F3A',
  navy700: '#122A4A',
  navy600: '#1B3A63',
  emerald: '#0E8F60',
  emeraldBright: '#18B57A',
  gold: '#C9963C',
  goldBright: '#E5B25C',
  // Neutrals
  white: '#FFFFFF',
  ink: '#0B1620',
  slate50: '#F4F6F9',
  slate100: '#EDF1F6',
  slate200: '#E3E9F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#61708A',
  slate600: '#475569',
  // Status
  red: '#D64550',
  amber: '#E0A52E',
  blue: '#2D6FB8',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  cardElevated: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  accent: string;
  onAccent: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  border: string;
  divider: string;
  overlay: string;
  brand: string; // navy chrome (headers, hero)
  onBrand: string;
  tabBar: string;
  tabActive: string;
  tabInactive: string;
  skeleton: string;
}

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  spacing: (n: number) => number;
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  font: {
    size: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; display: number };
    weight: { regular: TextStyle['fontWeight']; medium: TextStyle['fontWeight']; semibold: TextStyle['fontWeight']; bold: TextStyle['fontWeight'] };
    lineHeight: { tight: number; normal: number; relaxed: number };
  };
  shadow: { card: ViewStyle; floating: ViewStyle };
}

const shared = {
  spacing: (n: number) => n * 4,
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  font: {
    size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, display: 34 },
    weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
    lineHeight: { tight: 1.15, normal: 1.4, relaxed: 1.6 },
  },
} satisfies Pick<Theme, 'spacing' | 'radius' | 'font'>;

export const lightTheme: Theme = {
  ...shared,
  dark: false,
  colors: {
    background: palette.slate50,
    surface: palette.white,
    card: palette.white,
    cardElevated: palette.white,
    text: palette.navy800,
    textMuted: palette.slate500,
    textInverse: palette.white,
    primary: palette.emerald,
    onPrimary: palette.white,
    primarySoft: '#E2F4EC',
    accent: palette.gold,
    onAccent: '#1A1206',
    success: palette.emerald,
    danger: palette.red,
    warning: palette.amber,
    info: palette.blue,
    border: palette.slate200,
    divider: palette.slate100,
    overlay: 'rgba(11,31,58,0.45)',
    brand: palette.navy800,
    onBrand: palette.white,
    tabBar: palette.white,
    tabActive: palette.emerald,
    tabInactive: palette.slate400,
    skeleton: palette.slate200,
  },
  shadow: {
    card: { shadowColor: '#0B1F3A', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
    floating: { shadowColor: '#0B1F3A', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  },
};

export const darkTheme: Theme = {
  ...shared,
  dark: true,
  colors: {
    background: palette.navy900,
    surface: '#0E1D31',
    card: '#122844',
    cardElevated: '#16314F',
    text: '#ECF2F8',
    textMuted: '#93A6BC',
    textInverse: palette.navy900,
    primary: palette.emeraldBright,
    onPrimary: '#04130C',
    primarySoft: '#0F3A2C',
    accent: palette.goldBright,
    onAccent: '#1A1206',
    success: palette.emeraldBright,
    danger: '#F0606B',
    warning: '#F0BC4E',
    info: '#5B9BD8',
    border: '#1E3149',
    divider: '#18283C',
    overlay: 'rgba(0,0,0,0.6)',
    brand: palette.navy800,
    onBrand: palette.white,
    tabBar: '#0B1B2E',
    tabActive: palette.emeraldBright,
    tabInactive: '#5E7388',
    skeleton: '#1B2D44',
  },
  shadow: {
    card: { shadowColor: '#000000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
    floating: { shadowColor: '#000000', shadowOpacity: 0.55, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  },
};
