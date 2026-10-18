import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

export default function GreenBackdrop() {
  return (
    <View pointerEvents="none" style={styles.fill}>
      <LinearGradient
        colors={['#C9EFD9', '#E5F7EE', '#F7FCF9']}
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
