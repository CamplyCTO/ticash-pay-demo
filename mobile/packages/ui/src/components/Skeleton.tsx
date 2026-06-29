import React, { useEffect, useRef } from 'react';
import { Animated, type DimensionValue, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

/** Shimmering placeholder block (pulsing opacity loop). */
export function Skeleton({ width = '100%', height = 16, radius, style }: SkeletonProps) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius ?? t.radius.sm, backgroundColor: t.colors.skeleton, opacity: pulse },
        style,
      ]}
    />
  );
}
