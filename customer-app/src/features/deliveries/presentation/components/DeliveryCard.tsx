import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePressScale } from '../../../../components/useMotion';

import ErrorMessage from '../../../../components/ErrorMessage';
import { colors, radius, spacing, typography } from '../../../../theme';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { deliveryCardAddress, deliveryContentKind } from '../../domain/deliveryCard';
import { ContentIcon, ContentLabel, LocationPin, ServiceClassBadge, StopLabel, deliveryIcon } from '../deliveryIcons';
import {
  deliveryCanSearchAgain,
  deliveryCardStatusLabel,
  showsViewBids,
  type CustomerDelivery,
  type DeliveryStatus,
} from '../../domain/deliveryStatus';

type DeliveryCardProps = {
  delivery: CustomerDelivery;
  cached?: boolean;
  onOpenDetails?: (deliveryId: string) => void;
  onSearchAgain?: (deliveryId: string) => Promise<void>;
};

type StatusTone = {
  background: string;
  color: string;
};

const STATUS_TONES: Record<DeliveryStatus, StatusTone> = {
  CREATED: { background: '#EEF2F6', color: '#475569' },
  SEARCHING: { background: '#EEF2F6', color: '#475569' },
  NO_RIDER_FOUND: { background: '#FFF4E5', color: '#C56A12' },
  ASSIGNED: { background: '#E9F8EF', color: '#087A4A' },
  ARRIVED_AT_PICKUP: { background: '#E9F8EF', color: '#087A4A' },
  PICKED_UP: { background: '#E9F8EF', color: '#087A4A' },
  IN_TRANSIT: { background: '#E9F8EF', color: '#087A4A' },
  ARRIVED_AT_DROPOFF: { background: '#E9F8EF', color: '#087A4A' },
  RIDER_ASSIGNED: { background: '#E9F8EF', color: '#087A4A' },
  COLLECTING: { background: '#E9F8EF', color: '#087A4A' },
  COLLECTED: { background: '#E9F8EF', color: '#087A4A' },
  OUT_FOR_DELIVERY: { background: '#E9F8EF', color: '#087A4A' },
  DELIVERED: { background: '#E9F8EF', color: '#087A4A' },
  CANCELLED: { background: '#FDECEC', color: '#D92D20' },
  FAILED: { background: '#FDECEC', color: '#D92D20' },
};

const ICON_SIZE = deliveryIcon.size;
const DOT_SIZE = 3;
const DOT_STEP = 7;

export default function DeliveryCard({
  delivery,
  cached = false,
  onOpenDetails,
  onSearchAgain,
}: DeliveryCardProps) {
  const press = usePressScale();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const tone = STATUS_TONES[delivery.status];
  const contentKind = deliveryContentKind(delivery.parcelDescription);
  const canSearch = deliveryCanSearchAgain(delivery) && Boolean(onSearchAgain);
  const canViewBids = showsViewBids(delivery) && Boolean(onOpenDetails);

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
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
    <Pressable
      accessibilityRole={onOpenDetails ? 'button' : undefined}
      accessibilityLabel={onOpenDetails ? `View details for delivery ${delivery.id}` : undefined}
      onPress={onOpenDetails ? () => onOpenDetails(delivery.id) : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={styles.card}
    >
      <View style={styles.body}>
        <View style={styles.summary}>
          <View style={styles.summaryBody}>
            <View style={styles.badgeRow}>
              <View style={styles.contentBadge}>
                <ContentIcon kind={contentKind} />
                <ContentLabel kind={contentKind} />
              </View>
              <ServiceClassBadge serviceClass={delivery.serviceClass} />
            </View>
            <RouteStops
              pickup={delivery.pickupAddress}
              dropoff={delivery.dropoffAddress}
            />
          </View>
          <View pointerEvents="none" style={styles.statusFloat}>
            <StatusPill
              tone={tone}
              label={deliveryCardStatusLabel(delivery)}
              pulse={!cached && delivery.serviceClass != null && delivery.status === 'CREATED'}
            />
          </View>
        </View>
        {canViewBids ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View bids for delivery ${delivery.id}`}
            onPress={(event) => {
              event.stopPropagation();
              onOpenDetails?.(delivery.id);
            }}
            style={styles.searchButton}
          >
            <Text style={styles.searchText}>View bids</Text>
          </Pressable>
        ) : null}
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
        {searchError ? <ErrorMessage message={searchError} /> : null}
      </View>
      <View style={styles.divider} />
    </Pressable>
    </Animated.View>
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
      <Text numberOfLines={1} style={[styles.pillText, { color: tone.color }]}>{label}</Text>
    </Animated.View>
  );
}

function RouteStops({
  pickup,
  dropoff,
}: {
  pickup: string;
  dropoff: string;
}) {
  return (
    <View style={styles.route}>
      <Stop label="Pickup" address={pickup} connect />
      <Stop label="Drop-off" address={dropoff} dropoff />
    </View>
  );
}

function Stop({
  label,
  address,
  dropoff = false,
  connect = false,
}: {
  label: string;
  address: string;
  dropoff?: boolean;
  connect?: boolean;
}) {
  return (
    <View style={styles.stop}>
      <View style={styles.markerColumn}>
        <View style={styles.pinCircle}>
          <LocationPin dropoff={dropoff} />
        </View>
        {connect ? <DottedConnector /> : null}
      </View>
      <View style={styles.placeText}>
        <StopLabel>{label}</StopLabel>
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
    boxShadow: '0 2px 8px rgba(23, 33, 29, 0.14)',
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryBody: {
    flex: 1,
    gap: spacing.xs,
  },
  statusFloat: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  contentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    paddingRight: 96,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.border,
  },
  pill: {
    flexShrink: 0,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pillText: {
    fontSize: typography.small,
    fontWeight: '700',
  },
  route: {
    gap: spacing.sm,
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  markerColumn: {
    width: ICON_SIZE,
    alignItems: 'flex-start',
  },
  pinCircle: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  connector: {
    position: 'absolute',
    top: ICON_SIZE,
    bottom: -spacing.sm,
    width: ICON_SIZE,
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
  placeValue: {
    fontSize: typography.caption,
    lineHeight: 18,
    fontWeight: '400',
    color: colors.text,
  },
  searchButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
  },
  searchText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
});
