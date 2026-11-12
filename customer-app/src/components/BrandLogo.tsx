import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Palette } from '../theme';
import { useAppearance } from '../theme';

type BrandLogoProps = {
  style?: StyleProp<ViewStyle>;
};

export default function BrandLogo({ style }: BrandLogoProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.logo, style]}>
      <Text style={styles.letter}>R</Text>
      <View>
        <Text style={styles.name}>iders</Text>
        <Text style={styles.caption}>DELIVERY</Text>
      </View>
    </View>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  letter: {
    fontSize: 66,
    fontWeight: '900',
    color: colors.primary,
  },

  name: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.text,
  },

  caption: {
    fontSize: 12,
    letterSpacing: 4,
    color: colors.textSecondary,
  },
});
}
