import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../../theme';
import type { DeliveryContentKind } from '../domain/deliveryCard';

export const deliveryIcon = {
  size: 18,
  color: '#000000',
  pickup: '#000000',
  dropoff: colors.text,
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
  const content = CONTENT_ICONS[kind];
  return <MaterialDesignIcons name={content.icon} color={deliveryIcon.color} size={deliveryIcon.size} />;
}

export function LocationPin({ dropoff = false }: { dropoff?: boolean }) {
  return (
    <MaterialDesignIcons
      name="map-marker-outline"
      color={dropoff ? deliveryIcon.dropoff : deliveryIcon.pickup}
      size={deliveryIcon.size}
    />
  );
}

export function ContentLabel({ kind }: { kind: DeliveryContentKind }) {
  return (
    <Text style={[styles.contentLabel, kind === 'parcel' && styles.parcelLabel]}>
      {CONTENT_ICONS[kind].label}
    </Text>
  );
}

export function StopLabel({ children }: { children: string }) {
  return <Text style={styles.stopLabel}>{children}</Text>;
}

export function ServiceClassBadge({ serviceClass }: { serviceClass?: 'EXPRESS' | 'FLEXIBLE' | null }) {
  const urgent = serviceClass === 'EXPRESS';
  return (
    <View style={styles.classChip}>
      <MaterialDesignIcons
        name={urgent ? 'flash-outline' : 'message-text-outline'}
        color="#000000"
        size={16}
        style={urgent ? styles.urgentIcon : undefined}
      />
      <Text style={styles.classChipText}>{urgent ? 'Urgent' : 'Flexible'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contentLabel: {
    fontSize: typography.caption,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.text,
    includeFontPadding: false,
  },
  parcelLabel: {
    fontSize: 16,
    lineHeight: 22,
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
    backgroundColor: '#FFFFFF',
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
