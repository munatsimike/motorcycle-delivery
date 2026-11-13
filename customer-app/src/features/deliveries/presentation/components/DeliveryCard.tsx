import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePressScale } from '../../../../components/useMotion';

import ErrorMessage from '../../../../components/ErrorMessage';
import type { Palette } from '../../../../theme';
import { radius, spacing, typography, useAppearance } from '../../../../theme';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { deliveryCardAddress, deliveryContentKind } from '../../domain/deliveryCard';
import { ContentIcon, ContentLabel, LocationPin, ServiceClassBadge, deliveryIcon } from '../deliveryIcons';
import {
  deliveryCanSearchAgain,
  deliveryCardStatusLabel,
  showsViewBids,
  type CustomerDelivery,
} from '../../domain/deliveryStatus';
import { deliveryStatusTone, type StatusTone } from '../deliveryStatusTone';

type DeliveryCardProps = {
  delivery: CustomerDelivery;
  cached?: boolean;
  translucent?: boolean;
  onOpenDetails?: (deliveryId: string) => void;
  onSearchAgain?: (deliveryId: string) => Promise<void>;
};

const ICON_SIZE = deliveryIcon.size;

export default function DeliveryCard({
  delivery,
  cached = false,
  translucent = false,
  onOpenDetails,
  onSearchAgain,
}: DeliveryCardProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const press = usePressScale();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const bidsReceived = showsViewBids(delivery);
  const tone = deliveryStatusTone(delivery.status, colors, bidsReceived);
  const contentKind = deliveryContentKind(delivery.parcelDescription);
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
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
    <Pressable
      accessibilityRole={onOpenDetails ? 'button' : undefined}
      accessibilityLabel={onOpenDetails ? `View details for delivery ${delivery.id}` : undefined}
      onPress={onOpenDetails ? () => onOpenDetails(delivery.id) : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.card, translucent && styles.cardTranslucent]}
    >
      <View style={styles.body}>
        <View style={styles.summary}>
          <View style={styles.summaryBody}>
            <View style={styles.badgeRow}>
              <View style={styles.contentBadge}>
                <ContentIcon kind={contentKind} />
                <ContentLabel kind={contentKind} />
                {delivery.serviceClass ? <ServiceClassBadge serviceClass={delivery.serviceClass} /> : null}
              </View>
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
        {canSearch ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Search again for delivery ${delivery.id}`}
            disabled={searching}
            onPress={() => {
              void searchAgain();
            }}
            style={[styles.searchButton, styles.compactAction]}
          >
            <MaterialDesignIcons name="refresh" color={colors.primary} size={16} />
            <Text style={styles.searchText}>{searching ? 'Searching' : 'Search again'}</Text>
          </Pressable>
        ) : null}
        {searchError ? <ErrorMessage message={searchError} /> : null}
      </View>
    </Pressable>
    </Animated.View>
  );
}

function StatusPill({ tone, label, pulse }: { tone: StatusTone; label: string; pulse: boolean }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const presence = useRef(new Animated.Value(1)).current;
  const opacity = presence.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const scale = presence.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });

  useEffect(() => {
    if (!pulse) {
      presence.stopAnimation();
      presence.setValue(1);
      return;
    }
    presence.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(presence, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(presence, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [presence, pulse]);

  return (
    <Animated.View style={[styles.pill, { backgroundColor: tone.background, opacity }, pulse ? { transform: [{ scale }] } : null]}>
      <Text numberOfLines={1} style={[styles.pillText, { color: tone.color }]}>{label}</Text>
    </Animated.View>
  );
}

function RouteStops({
  pickup,
  dropoff,
  compact = false,
}: {
  pickup: string;
  dropoff: string;
  compact?: boolean;
}) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.route, compact && styles.routeCompact]}>
      <Stop address={pickup} />
      <Stop address={dropoff} dropoff />
    </View>
  );
}

function Stop({
  address,
  dropoff = false,
}: {
  address: string;
  dropoff?: boolean;
}) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.stop}>
      <View style={styles.markerColumn}>
        <View style={styles.pinCircle}>
          <LocationPin dropoff={dropoff} />
        </View>
      </View>
      <View style={styles.placeText}>
        <Text style={styles.placeValue}>{deliveryCardAddress(address)}</Text>
      </View>
    </View>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.listCardBorder,
    boxShadow: '0 2px 8px rgba(23, 33, 29, 0.08)',
  },
  cardTranslucent: {
    backgroundColor: colors.background,
  },
  cardCompact: {
    marginHorizontal: spacing.sm,
  },
  body: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  bodyCompact: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryBody: {
    flex: 1,
    gap: spacing.md,
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
    gap: 8,
  },
  routeCompact: {
    gap: spacing.xs,
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
  placeText: {
    flex: 1,
    gap: 2,
  },
  placeValue: {
    fontSize: 16,
    lineHeight: 21,
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
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
  },
  compactAction: {
    flex: 0,
    alignSelf: 'flex-end',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  searchText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
});
}
