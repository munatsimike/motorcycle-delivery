import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import DialogModal, { DialogActions, DialogTextButton, DialogTitle } from '../../../../components/DialogModal';
import FormInput from '../../../../components/FormInput';
import { colors, spacing, typography } from '../../../../theme';
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
    onApply(applied.patch);
    setPending(null);
    setMessage(null);
  }

  function cancel() {
    pickupAfterCancel(stop);
    setPending(null);
    setConfirmError(null);
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
      <DialogModal visible={pending !== null} onClose={cancel} closeLabel="Cancel">
        <DialogTitle>Pickup location</DialogTitle>
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
        <DialogActions>
          <DialogTextButton label="Cancel" tone="neutral" onPress={cancel} />
          <DialogTextButton label="Confirm pickup location" onPress={confirm} />
        </DialogActions>
      </DialogModal>
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
});
