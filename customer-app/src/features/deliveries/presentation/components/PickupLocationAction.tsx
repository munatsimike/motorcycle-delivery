import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import FormInput from '../../../../components/FormInput';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { useReduceMotion } from '../../../../components/useMotion';
import { motionDuration, MODAL_MS } from '../../../../navigation/screenMotion';
import { colors, radius, spacing, typography } from '../../../../theme';
import { expoPickupLocation } from '../../data/expoPickupLocation';
import type { StopDraft } from '../../domain/bookingDraft';
import {
  applyConfirmedPickup,
  detectPickupLocation,
  finishPickupDetection,
  pickupAfterCancel,
  pickupLocationMessage,
  startPickupDetection,
  type PickupDetection,
} from '../../domain/pickupLocation';

type PickupLocationActionProps = {
  stop: StopDraft;
  onApply: (patch: Partial<StopDraft>) => void;
};

type PendingPickup = Extract<PickupDetection, { status: 'confirm' }>;

export default function PickupLocationAction({ stop, onApply }: PickupLocationActionProps) {
  const [detecting, setDetecting] = useState(false);
  const [flight] = useState(() => ({ inFlight: false }));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPickup | null>(null);
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const reduceMotion = useReduceMotion();
  const closing = useRef(false);
  const card = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pending) {
      closing.current = false;
      return;
    }
    const duration = motionDuration(MODAL_MS, reduceMotion);
    card.setValue(duration === 0 ? 1 : 0);
    if (duration === 0) {
      return;
    }
    Animated.timing(card, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [card, pending, reduceMotion]);

  function closeCard(done: () => void) {
    if (closing.current) {
      return;
    }
    closing.current = true;
    const duration = motionDuration(MODAL_MS, reduceMotion);
    if (duration === 0) {
      done();
      return;
    }
    Animated.timing(card, {
      toValue: 0,
      duration,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        done();
      } else {
        closing.current = false;
      }
    });
  }

  async function detect() {
    if (!startPickupDetection(flight)) {
      return;
    }
    setDetecting(true);
    setMessage(null);
    try {
      const servicesEnabled = await expoPickupLocation.servicesEnabled();
      const permission = await expoPickupLocation.permission();
      const result = await detectPickupLocation({
        servicesEnabled,
        permission,
        requestPermission: () => expoPickupLocation.requestPermission(),
        readFix: () => expoPickupLocation.readFix(),
        reverseGeocode: (latitude, longitude) => expoPickupLocation.reverseGeocode(latitude, longitude),
        now: Date.now(),
      }, typeof __DEV__ !== 'undefined' && __DEV__);
      if (result.status === 'confirm') {
        setPending(result);
        setAddress(result.address);
        setLandmark('');
        setConfirmError(null);
        return;
      }
      setMessage(pickupLocationMessage(result.status));
    } finally {
      finishPickupDetection(flight);
      setDetecting(false);
    }
  }

  function confirm() {
    if (!pending) {
      return;
    }
    const applied = applyConfirmedPickup({
      latitude: pending.latitude,
      longitude: pending.longitude,
      address,
      landmark,
    });
    if (!applied.ok) {
      setConfirmError(applied.error);
      return;
    }
    closeCard(() => {
      onApply(applied.patch);
      setPending(null);
      setMessage(null);
    });
  }

  function cancel() {
    closeCard(() => {
      pickupAfterCancel(stop);
      setPending(null);
      setConfirmError(null);
    });
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use my current location"
        accessibilityState={{ busy: detecting, disabled: detecting }}
        disabled={detecting}
        onPress={() => {
          void detect();
        }}
        style={({ pressed }) => [styles.action, pressed && !detecting && styles.pressed]}
      >
        {detecting ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <MaterialDesignIcons name="crosshairs-gps" color={colors.primary} size={18} />
        )}
        <Text style={styles.label}>{detecting ? 'Finding your location' : 'Use my current location'}</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Modal animationType="none" transparent visible={pending !== null} onRequestClose={cancel}>
        <Animated.View style={[styles.backdrop, { opacity: card }]}>
          <Animated.View
            style={[
              styles.card,
              {
                opacity: card,
                transform: [{
                  translateY: card.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                }],
              },
            ]}
          >
            <Text style={styles.title}>Pickup location</Text>
            <FormInput
              label="Pickup address"
              value={address}
              onChangeText={setAddress}
              placeholder="Describe this pickup point"
              maxLength={500}
              error={confirmError === 'Enter the pickup address' ? confirmError : null}
            />
            <FormInput
              label="Landmark (optional)"
              value={landmark}
              onChangeText={setLandmark}
              placeholder="Near the main gate"
              maxLength={200}
              error={confirmError === 'Enter the pickup landmark' ? confirmError : null}
            />
            <PrimaryButton label="Confirm pickup location" onPress={confirm} />
            <SecondaryButton label="Cancel" bordered={false} onPress={cancel} />
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: -spacing.md,
  },
  action: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.primary,
  },
  message: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.error,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(23, 33, 29, 0.4)',
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.heading,
    lineHeight: 26,
    color: colors.text,
  },
});
