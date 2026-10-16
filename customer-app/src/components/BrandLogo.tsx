import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../theme';

type BrandLogoProps = {
  style?: StyleProp<ViewStyle>;
};

export default function BrandLogo({ style }: BrandLogoProps) {
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

const styles = StyleSheet.create({
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
