import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import { colors, radius } from '../../../../theme';

const LOOP_MS = 2800;
const RING_DELAYS = [0, 900, 1800];
const RING = 164;

type RiderSearchAnimationProps = {
  active: boolean;
};

export default function RiderSearchAnimation({ active }: RiderSearchAnimationProps) {
  const reduceMotion = useReduceMotion();
  const running = active && !reduceMotion;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Searching for riders"
      style={styles.stage}
    >
      {running ? RING_DELAYS.map((delay) => (
        <RadarRing key={delay} delay={delay} running />
      )) : (
        <RadarRing delay={0} running={false} />
      )}
      <FloatingIcon running={running} />
    </View>
  );
}

function RadarRing({ delay, running }: { delay: number; running: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!running) {
      progress.stopAnimation();
      progress.setValue(0.62);
      return;
    }
    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: LOOP_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    const timer = setTimeout(() => {
      animation.start();
    }, delay);
    return () => {
      clearTimeout(timer);
      animation.stop();
    };
  }, [delay, progress, running]);

  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0.12, 0.4, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { opacity, transform: [{ scale }] }]}
    />
  );
}

function FloatingIcon({ running }: { running: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!running) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: LOOP_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: LOOP_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, running]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });

  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <View style={styles.iconCircle}>
        <MaterialDesignIcons name="motorbike" size={22} color={colors.textInverse} />
      </View>
    </Animated.View>
  );
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) {
        setReduceMotion(enabled);
      }
    }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

const styles = StyleSheet.create({
  stage: {
    width: 200,
    height: 188,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
});
