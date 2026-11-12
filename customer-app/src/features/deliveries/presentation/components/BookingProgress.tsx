import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../../../../theme';
import { useAppearance, radius, spacing, typography } from '../../../../theme';
import { BOOKING_STEPS, type BookingStep } from '../viewmodels/useParcelBooking';

const STEP_LABELS: Record<BookingStep, string> = {
  pickup: 'Pickup',
  destination: 'Drop-off',
  parcel: 'Parcel details',
  review: 'Review',
  confirm: 'Confirm',
};

type BookingProgressProps = {
  step: BookingStep;
};

export default function BookingProgress({ step }: BookingProgressProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const index = BOOKING_STEPS.indexOf(step);

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        {BOOKING_STEPS.map((item, itemIndex) => (
          <View
            key={item}
            style={[styles.segment, itemIndex <= index && styles.segmentActive]}
          />
        ))}
      </View>
      <Text style={styles.label}>
        Step {index + 1} of {BOOKING_STEPS.length} · {STEP_LABELS[step]}
      </Text>
    </View>
  );
}

export function bookingStepTitle(step: BookingStep): string {
  return STEP_LABELS[step];
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  track: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  label: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
});
}
