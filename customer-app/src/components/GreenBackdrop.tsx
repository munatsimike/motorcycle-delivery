import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useAppearance } from '../theme';

export default function GreenBackdrop() {
  const { scheme } = useAppearance();
  const wash = scheme === 'dark'
    ? ['#16352A', '#14241E', '#101614'] as const
    : ['#C9EFD9', '#E5F7EE', '#F7FCF9'] as const;
  return (
    <View pointerEvents="none" style={styles.fill}>
      <LinearGradient
        colors={wash}
        locations={[0, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glow} />
      <View style={styles.arc} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.45)',
    top: -90,
    right: -50,
  },
  arc: {
    position: 'absolute',
    width: 720,
    height: 720,
    borderRadius: 360,
    backgroundColor: 'rgba(255,255,255,0.55)',
    bottom: -560,
    left: -120,
  },
});
