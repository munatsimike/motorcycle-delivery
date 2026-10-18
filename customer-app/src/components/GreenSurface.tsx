import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing } from '../theme';
import GreenBackdrop from './GreenBackdrop';

type GreenSurfaceProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  fadeStyle?: StyleProp<ViewStyle>;
  fadeColors?: readonly [string, string, ...string[]];
};

export default function GreenSurface({ children, style, fadeStyle, fadeColors }: GreenSurfaceProps) {
  return (
    <View>
      <View style={[styles.surface, style]}>
        <GreenBackdrop />
        {children}
      </View>
      <LinearGradient
        colors={fadeColors ?? ['#F7FCF9', colors.background]}
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
