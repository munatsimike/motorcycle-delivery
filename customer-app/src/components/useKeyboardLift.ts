import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, ScrollView, TextInput } from 'react-native';

export const KeyboardFieldFocusContext = createContext<() => void>(() => {});

export function useRevealFocusedField(): () => void {
  return useContext(KeyboardFieldFocusContext);
}

const FIELD_CLEARANCE = 88;

export function useKeyboardLift() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);

  function revealFocusedField() {
    const top = keyboardTop.current;
    const focused = TextInput.State.currentlyFocusedInput() as {
      measureInWindow?: (
        callback: (x: number, y: number, width: number, height: number) => void,
      ) => void;
    } | null;
    if (top == null || focused?.measureInWindow == null) {
      return;
    }
    focused.measureInWindow((_x, y, _width, height) => {
      const overlap = y + height + FIELD_CLEARANCE - top;
      if (overlap <= 0) {
        return;
      }
      scrollRef.current?.scrollTo({
        y: scrollY.current + overlap,
        animated: true,
      });
    });
  }

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const windowHeight = Dimensions.get('window').height;
      const top = event.endCoordinates.screenY;
      const inset = top > 0
        ? Math.max(0, windowHeight - top)
        : event.endCoordinates.height;
      keyboardTop.current = top > 0 ? top : windowHeight - inset;
      setKeyboardInset(inset);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = null;
      setKeyboardInset(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardInset === 0) {
      return;
    }
    const frame = requestAnimationFrame(revealFocusedField);
    return () => cancelAnimationFrame(frame);
  }, [keyboardInset]);

  return {
    scrollRef,
    keyboardInset,
    revealFocusedField,
    onScroll: (offsetY: number) => {
      scrollY.current = offsetY;
    },
  };
}
