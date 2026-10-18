import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing } from '../theme';
import BrandLogo from './BrandLogo';

type BrandMarkProps = {
  style?: StyleProp<ViewStyle>;
};

export default function BrandMark({ style }: BrandMarkProps) {
  return (
    <View style={[styles.row, style]}>
      <Image
        source={require('../../assets/rider-image.png')}
        style={styles.rider}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
      <BrandLogo />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.md,
  },
  rider: {
    width: 129,
    height: 97,
  },
});
