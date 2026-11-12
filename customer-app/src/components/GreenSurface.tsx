import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing, useAppearance } from '../theme';
import GreenBackdrop from './GreenBackdrop';

type GreenSurfaceProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  fadeStyle?: StyleProp<ViewStyle>;
  fadeColors?: readonly [string, string, ...string[]];
};

export default function GreenSurface({ children, style, fadeStyle, fadeColors }: GreenSurfaceProps) {
  const { colors } = useAppearance();
  return (
    <View>
      <View style={[styles.surface, { backgroundColor: colors.canvas }, style]}>
        <GreenBackdrop />
        {children}
      </View>
      <LinearGradient
        colors={fadeColors ?? [colors.canvas, colors.background]}
        style={[styles.fade, fadeStyle]}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: '#F7FCF9',
  },
  fade: {
    height: spacing.xxxl,
  },
});
