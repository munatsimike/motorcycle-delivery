import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';

const OPEN_MS = 360;
const CLOSE_MS = 280;

type BottomSheetModalProps = {
  visible: boolean;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
};

export default function BottomSheetModal({
  visible,
  onClose,
  closeLabel = 'Close',
  children,
}: BottomSheetModalProps) {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const held = useRef(children);
  if (visible) {
    held.current = children;
  }
  if (visible && !mounted) {
    setMounted(true);
  }

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? OPEN_MS : CLOSE_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
    return () => animation.stop();
  }, [visible, progress]);

  if (!mounted) {
    return null;
  }

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [800, 0],
  });
  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.screen}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={styles.scrim}
        />
        <Animated.View
          onStartShouldSetResponder={() => true}
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          {held.current}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#17211D',
    opacity: 0.65,
  },
  sheet: {
    width: '100%',
  },
});
