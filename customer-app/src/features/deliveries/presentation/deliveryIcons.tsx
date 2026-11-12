import { useMemo } from 'react';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../../../theme';
import { radius, spacing, typography, useAppearance } from '../../../theme';
import type { DeliveryContentKind } from '../domain/deliveryCard';

export const deliveryIcon = {
  size: 22,
  pickup: '#169B62',
  dropoff: '#1A73E8',
} as const;

export const CONTENT_ICONS: Record<DeliveryContentKind, {
  label: string;
  icon: 'package-variant-closed' | 'file-document-outline' | 'silverware-fork-knife';
}> = {
  parcel: { label: 'Parcel', icon: 'package-variant-closed' },
  document: { label: 'Document', icon: 'file-document-outline' },
  food: { label: 'Food', icon: 'silverware-fork-knife' },
};

export function ContentIcon({ kind }: { kind: DeliveryContentKind }) {
  const { colors } = useAppearance();
  const content = CONTENT_ICONS[kind];
  return <MaterialDesignIcons name={content.icon} color={colors.textSecondary} size={15} />;
}

/** Shared solid map-pin design, matching the Android rider delivery cards. */
export function LocationPin({ dropoff = false }: { dropoff?: boolean }) {
  return (
    <View accessibilityLabel={dropoff ? 'Drop-off' : 'Pickup'}>
      <MaterialDesignIcons
        name="map-marker"
        color={dropoff ? deliveryIcon.dropoff : deliveryIcon.pickup}
        size={deliveryIcon.size}
      />
    </View>
  );
}

export function ContentLabel({ kind }: { kind: DeliveryContentKind }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Text style={[styles.contentLabel, kind === 'parcel' && styles.parcelLabel]}>
      {CONTENT_ICONS[kind].label}
    </Text>
  );
}

export function StopLabel({ children }: { children: string }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.stopLabel}>{children}</Text>;
}

export function ServiceClassBadge({ serviceClass }: { serviceClass?: 'EXPRESS' | 'FLEXIBLE' | null }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const urgent = serviceClass === 'EXPRESS';
  return (
    <View style={styles.classChip}>
      <MaterialDesignIcons
        name={urgent ? 'flash-outline' : 'message-text-outline'}
        color={colors.textSecondary}
        size={14}
        style={urgent ? styles.urgentIcon : undefined}
      />
      <Text style={styles.classChipText}>{urgent ? 'Urgent' : 'Flexible'}</Text>
    </View>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  contentLabel: {
    fontSize: typography.caption,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  parcelLabel: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  pickupPin: {
    width: deliveryIcon.size,
    height: deliveryIcon.size,
    alignItems: 'center',
  },
  pickupRing: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.6,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.text,
  },
  pickupStem: {
    width: 1.6,
    height: 7,
    backgroundColor: colors.text,
  },
  stopLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  classChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
  },
  urgentIcon: {
    // flash-outline leaves 3px more empty space before the label than message-text-outline
    marginRight: -3,
  },
  classChipText: {
    fontSize: typography.caption,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textSecondary,
    includeFontPadding: false,
  },
});
}
