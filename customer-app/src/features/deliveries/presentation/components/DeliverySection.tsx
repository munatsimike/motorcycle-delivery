import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ErrorMessage from '../../../../components/ErrorMessage';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import SecondaryButton from '../../../../components/SecondaryButton';
import { colors, radius, spacing, typography } from '../../../../theme';
import { deliveryWhenLabel, shortDeliveryReference } from '../../domain/deliveryCard';
import {
  deliveryStatusLabel,
  type CustomerDelivery,
  type DeliveryStatus,
} from '../../domain/deliveryStatus';
import { errorMessage } from '../../../auth/presentation/errorMessage';

type IconName = ComponentProps<typeof MaterialDesignIcons>['name'];

type DeliverySectionProps = {
  deliveries: CustomerDelivery[];
  isLoading: boolean;
  error: string | null;
  emptyTitle: string;
  emptyBody: string;
  onOpenDetails?: (deliveryId: string) => void;
  onRetry?: () => void;
  onSearchAgain?: (deliveryId: string) => Promise<void>;
};

type StatusTone = {
  icon: IconName;
  background: string;
  color: string;
};

const STATUS_TONES: Record<DeliveryStatus, StatusTone> = {
  CREATED: { icon: 'clock-outline', background: '#EEF2F6', color: '#475569' },
  SEARCHING: { icon: 'clock-outline', background: '#EEF2F6', color: '#475569' },
  NO_RIDER_FOUND: { icon: 'clock-outline', background: '#FFF4E5', color: '#C56A12' },
  ASSIGNED: { icon: 'motorbike', background: '#E9F8EF', color: '#087A4A' },
  ARRIVED_AT_PICKUP: { icon: 'motorbike', background: '#E9F8EF', color: '#087A4A' },
  PICKED_UP: { icon: 'motorbike', background: '#E9F8EF', color: '#087A4A' },
  IN_TRANSIT: { icon: 'motorbike', background: '#E9F8EF', color: '#087A4A' },
  ARRIVED_AT_DROPOFF: { icon: 'motorbike', background: '#E9F8EF', color: '#087A4A' },
  DELIVERED: { icon: 'check', background: '#E9F8EF', color: '#087A4A' },
  CANCELLED: { icon: 'close', background: '#FDECEC', color: '#D92D20' },
  FAILED: { icon: 'alert-circle-outline', background: '#FDECEC', color: '#D92D20' },
};

export default function DeliverySection({
  deliveries,
  isLoading,
  error,
  emptyTitle,
  emptyBody,
  onOpenDetails,
  onRetry,
  onSearchAgain,
}: DeliverySectionProps) {
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<{ id: string; message: string } | null>(null);

  async function searchAgain(deliveryId: string) {
    if (!onSearchAgain || searchingId) {
      return;
    }
    setSearchingId(deliveryId);
    setSearchError(null);
    try {
      await onSearchAgain(deliveryId);
    } catch (caught) {
      setSearchError({ id: deliveryId, message: errorMessage(caught, 'Rider search could not be started.') });
    } finally {
      setSearchingId(null);
    }
  }

  if (isLoading && deliveries.length === 0) {
    return <LoadingIndicator />;
  }

  return (
    <View style={styles.list}>
      {error ? <ErrorMessage message={error} /> : null}
      {error && onRetry ? <SecondaryButton label="Try again" onPress={onRetry} /> : null}
      {!error && deliveries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptyBody}>{emptyBody}</Text>
        </View>
      ) : null}
      {deliveries.map((delivery) => {
        const tone = STATUS_TONES[delivery.status];
        const when = deliveryWhenLabel(delivery.createdAt);
        const canSearch = delivery.status === 'NO_RIDER_FOUND' && Boolean(onSearchAgain);
        const searching = searchingId === delivery.id;
        return (
          <View key={delivery.id} style={styles.card}>
            <View style={styles.header}>
              <View style={styles.identity}>
                <View style={styles.packageBadge}>
                  <MaterialDesignIcons name="package-variant" color={colors.primary} size={18} />
                </View>
                <View style={styles.identityText}>
                  <Text style={styles.reference}>{shortDeliveryReference(delivery.id)}</Text>
                  {when ? <Text style={styles.when}>{when}</Text> : null}
                </View>
              </View>
              <View style={[styles.pill, { backgroundColor: tone.background }]}>
                <MaterialDesignIcons name={tone.icon} color={tone.color} size={14} />
                <Text style={[styles.pillText, { color: tone.color }]}>{deliveryStatusLabel(delivery.status)}</Text>
              </View>
            </View>
            <RouteStops pickup={delivery.pickupAddress} dropoff={delivery.dropoffAddress} />
            {onOpenDetails ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View details for delivery ${delivery.id}`}
                  onPress={() => onOpenDetails(delivery.id)}
                  style={styles.detailsButton}
                >
                  <MaterialDesignIcons name="information-outline" color={colors.textSecondary} size={16} />
                  <Text style={styles.detailsText}>View details</Text>
                  <MaterialDesignIcons name="chevron-right" color={colors.textSecondary} size={18} />
                </Pressable>
                {canSearch ? <View style={styles.actionDivider} /> : null}
                {canSearch ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Search again for delivery ${delivery.id}`}
                    disabled={searching}
                    onPress={() => {
                      void searchAgain(delivery.id);
                    }}
                    style={styles.searchButton}
                  >
                    <MaterialDesignIcons name="refresh" color={colors.primary} size={16} />
                    <Text style={styles.searchText}>{searching ? 'Searching' : 'Search again'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {searchError?.id === delivery.id ? <ErrorMessage message={searchError.message} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const PIN_SIZE = 32;
const DOT_SIZE = 3;
const DOT_STEP = 7;

function RouteStops({ pickup, dropoff }: { pickup: string; dropoff: string }) {
  return (
    <View style={styles.route}>
      <Stop label="Pickup" address={pickup} pin={colors.primary} badge={colors.primaryLight} connect />
      <Stop label="Drop-off" address={dropoff} pin={colors.error} badge="#FDECEC" />
    </View>
  );
}

function Stop({
  label,
  address,
  pin,
  badge,
  connect = false,
}: {
  label: string;
  address: string;
  pin: string;
  badge: string;
  connect?: boolean;
}) {
  return (
    <View style={styles.stop}>
      <View style={styles.markerColumn}>
        <View style={[styles.pinCircle, { backgroundColor: badge }]}>
          <MaterialDesignIcons name="map-marker" color={pin} size={18} />
        </View>
        {connect ? <DottedConnector /> : null}
      </View>
      <View style={styles.placeText}>
        <Text style={styles.placeLabel}>{label}</Text>
        <Text style={styles.placeValue}>{address}</Text>
      </View>
    </View>
  );
}

function DottedConnector() {
  const [count, setCount] = useState(0);

  return (
    <View
      pointerEvents="none"
      style={styles.connector}
      onLayout={(event) => {
        const next = Math.max(1, Math.floor(event.nativeEvent.layout.height / DOT_STEP));
        setCount((current) => (current === next ? current : next));
      }}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.dot} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  emptyTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    fontSize: typography.body,
    lineHeight: 24,
    color: colors.textSecondary,
  },
  list: {
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  packageBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  reference: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.text,
  },
  when: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    maxWidth: '48%',
  },
  pillText: {
    flexShrink: 1,
    fontSize: typography.small,
    fontWeight: '700',
  },
  route: {
    gap: spacing.md,
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  markerColumn: {
    width: PIN_SIZE,
    alignItems: 'center',
  },
  pinCircle: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    position: 'absolute',
    top: PIN_SIZE,
    bottom: -spacing.md,
    width: PIN_SIZE,
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: '#B7C2BC',
  },
  placeText: {
    flex: 1,
    gap: 2,
  },
  placeLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  placeValue: {
    fontSize: typography.body,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailsButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.background,
  },
  detailsText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  actionDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
  },
  searchButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primaryLight,
  },
  searchText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
});
