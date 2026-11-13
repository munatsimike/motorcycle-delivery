import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';

import { useReduceMotion } from '../../../../components/useMotion';
import { motionDuration, FORWARD_MS } from '../../../../navigation/screenMotion';
import { BOOKING_STEPS, type BookingStep } from '../viewmodels/useParcelBooking';

const STEP_SHIFT = 28;

export default function BookingStepMotion({
  step,
  children,
}: {
  step: BookingStep;
  children: ReactNode;
}) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const direction = useRef(1);
  const previous = useRef(step);

  if (previous.current !== step) {
    const nextIndex = BOOKING_STEPS.indexOf(step);
    const previousIndex = BOOKING_STEPS.indexOf(previous.current);
    direction.current = nextIndex >= previousIndex ? 1 : -1;
    previous.current = step;
    progress.setValue(motionDuration(FORWARD_MS, reduce) === 0 ? 1 : 0);
  }

  useEffect(() => {
    const duration = motionDuration(FORWARD_MS, reduce);
    if (duration === 0) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, reduce, step]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [direction.current * STEP_SHIFT, 0],
  });

  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateX }] }}>
      {children}
    </Animated.View>
  );
}
