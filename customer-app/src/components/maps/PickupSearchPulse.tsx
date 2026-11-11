import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { Circle } from 'react-native-maps';

import { useReduceMotion } from '../useMotion';
import { SEARCH_PULSE_MS, searchPulseRings, searchRingColor } from '../../features/deliveries/domain/searchPulse';

type MapPoint = { latitude: number; longitude: number };

const FRAME_MS = 70;

type Props = {
  coordinate: MapPoint;
  active: boolean;
};

/** Soft rings anchored to a map coordinate. They are not rider positions. */
export default function PickupSearchPulse({ coordinate, active }: Props) {
  const reduceMotion = useReduceMotion();
  const [progress, setProgress] = useState(0);
  const clock = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      return undefined;
    }
    let alive = true;
    let lastFrame = 0;
    clock.setValue(0);
    const animation = Animated.loop(
      Animated.timing(clock, {
        toValue: 1,
        duration: SEARCH_PULSE_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    const listener = clock.addListener(({ value }) => {
      const now = Date.now();
      if (!alive || now - lastFrame < FRAME_MS) {
        return;
      }
      lastFrame = now;
      setProgress(value);
    });
    animation.start();
    return () => {
      alive = false;
      animation.stop();
      clock.removeListener(listener);
    };
  }, [active, clock, reduceMotion]);

  if (!active) {
    return null;
  }

  return (
    <>
      {searchPulseRings(progress, reduceMotion).map((ring, index) => (
        <Circle
          key={reduceMotion ? 'still' : index}
          center={coordinate}
          radius={ring.radius}
          fillColor={searchRingColor(ring.opacity)}
          strokeColor={searchRingColor(ring.opacity, 1.7)}
          strokeWidth={2}
          zIndex={0}
        />
      ))}
    </>
  );
}
