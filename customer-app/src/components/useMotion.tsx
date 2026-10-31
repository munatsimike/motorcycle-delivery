import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, type StyleProp, type TextStyle } from 'react-native';

import { motionDuration, PRESS_MS, PRESS_SCALE, STATUS_MS } from '../navigation/screenMotion';

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) {
        setReduce(value);
      }
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduce;
}

export function usePressScale() {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  function onPressIn() {
    const duration = motionDuration(PRESS_MS, reduce);
    if (duration === 0) {
      return;
    }
    Animated.timing(scale, {
      toValue: PRESS_SCALE,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }

  function onPressOut() {
    const duration = motionDuration(PRESS_MS, reduce);
    if (duration === 0) {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }

  return { scale, onPressIn, onPressOut };
}

export function FadeSwapText({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
}) {
  const reduce = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const shown = useRef(text);

  useEffect(() => {
    if (shown.current === text) {
      return;
    }
    shown.current = text;
    const duration = motionDuration(STATUS_MS, reduce);
    if (duration === 0) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0.45);
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [opacity, reduce, text]);

  return <Animated.Text style={[style, { opacity }]}>{text}</Animated.Text>;
}
