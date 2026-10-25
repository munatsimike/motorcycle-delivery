import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import type { ComponentProps } from 'react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import ErrorMessage from '../../../../components/ErrorMessage';
import { colors, radius, spacing, typography } from '../../../../theme';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { formatDeadline } from '../../domain/bookingDraft';
import { deliveryCardAddress } from '../../domain/deliveryCard';
import {
  deliveryCanSearchAgain,
  deliveryListLabel,
  deliveryUsesPackageIcon,
  type CustomerDelivery,
  type DeliveryStatus,
} from '../../domain/deliveryStatus';

type IconName = ComponentProps<typeof MaterialDesignIcons>['name'];

type DeliveryCardProps = {
  delivery: CustomerDelivery;
  cached?: boolean;
  onOpenDetails?: (deliveryId: string) => void;
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
  RIDER_ASSIGNED: { icon: 'motorbike', background: '#E9F8EF', color: '#087A4A' },
  COLLECTING: { icon: 'motorbike', background: '#E9F8EF', color: '#087A4A' },
  COLLECTED: { icon: 'package-variant', background: '#E9F8EF', color: '#087A4A' },
  OUT_FOR_DELIVERY: { icon: 'motorbike', background: '#E9F8EF', color: '#087A4A' },
  DELIVERED: { icon: 'check', background: '#E9F8EF', color: '#087A4A' },
  CANCELLED: { icon: 'close', background: '#FDECEC', color: '#D92D20' },
  FAILED: { icon: 'alert-circle-outline', background: '#FDECEC', color: '#D92D20' },
};

const PIN_SIZE = 32;
const DOT_SIZE = 3;
const DOT_STEP = 7;

export default function DeliveryCard({
  delivery,
  cached = false,
  onOpenDetails,
  onSearchAgain,
}: DeliveryCardProps) {
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const tone = STATUS_TONES[delivery.status];
  const packageIcon = deliveryUsesPackageIcon(delivery.status);
  const canSearch = deliveryCanSearchAgain(delivery) && Boolean(onSearchAgain);

  async function searchAgain() {
    if (!onSearchAgain || searching) {
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      await onSearchAgain(delivery.id);
    } catch (caught) {
      setSearchError(errorMessage(caught, 'Rider search could not be started.'));
    } finally {
      setSearching(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.body}>
        {packageIcon ? (
          <View style={styles.packageIcon}>
            <MaterialDesignIcons name="package-variant" color={colors.primary} size={20} />
          </View>
        ) : null}
        <RouteStops
          pickup={delivery.pickupAddress}
          dropoff={delivery.dropoffAddress}
          status={(
            <StatusPill
              tone={tone}
              label={deliveryListLabel(delivery)}
              pulse={!cached && delivery.status === 'SEARCHING'}
            />
          )}
        />
        {delivery.serviceClass ? (
          <Text style={styles.marketplace}>
            {[
              delivery.serviceClass === 'EXPRESS' ? 'Express' : 'Flexible',
              delivery.deliverBy ? formatDeadline(delivery.deliverBy) : null,
              delivery.suggestedPrice ? `${delivery.currency ?? 'USD'} ${delivery.suggestedPrice}` : null,
            ].filter((part) => part).join(' · ')}
          </Text>
        ) : null}
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
                  void searchAgain();
                }}
                style={styles.searchButton}
              >
                <MaterialDesignIcons name="refresh" color={colors.primary} size={16} />
                <Text style={styles.searchText}>{searching ? 'Searching' : 'Search again'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {searchError ? <ErrorMessage message={searchError} /> : null}
      </View>
      <View style={styles.divider} />
    </View>
  );
}

function StatusPill({ tone, label, pulse }: { tone: StatusTone; label: string; pulse: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, pulse]);

  return (
    <Animated.View style={[styles.pill, { backgroundColor: tone.background, opacity }]}>
      <MaterialDesignIcons name={tone.icon} color={tone.color} size={14} />
      <Text style={[styles.pillText, { color: tone.color }]}>{label}</Text>
    </Animated.View>
  );
}

function RouteStops({
  pickup,
  dropoff,
  status,
}: {
  pickup: string;
  dropoff: string;
  status: ReactNode;
}) {
  return (
    <View style={styles.route}>
      <Stop label="Pickup" address={pickup} pin={colors.primary} badge={colors.primaryLight} connect aside={status} />
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
  aside = null,
}: {
  label: string;
  address: string;
  pin: string;
  badge: string;
  connect?: boolean;
  aside?: ReactNode;
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
        <View style={styles.placeHead}>
          <Text style={styles.placeLabel}>{label}</Text>
          {aside}
        </View>
        <Text style={styles.placeValue}>{deliveryCardAddress(address)}</Text>
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
  card: {
    backgroundColor: '#F8FAF9',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0 4px 16px rgba(23, 33, 29, 0.08)',
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  packageIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.border,
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
  placeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
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
  marketplace: {
    marginTop: spacing.sm,
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primaryDark,
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
    backgroundColor: colors.surface,
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
    borderWidth: 1,
    borderColor: 'rgba(22, 155, 98, 0.35)',
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
