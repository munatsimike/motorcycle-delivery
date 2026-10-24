import { useEffect, useLayoutEffect, useState } from 'react';
import { Alert, AppState, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import ErrorMessage from '../../../../components/ErrorMessage';
import GreenSurface from '../../../../components/GreenSurface';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { customerDeliveryRepository, loadDeliveryMapImage } from '../../data/CustomerDeliveryApiRepository';
import { cancelCustomerDelivery } from '../../domain/usecases/cancelCustomerDelivery';
import { deliveryHasMapCoordinates, type CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { deliveryCardAddress, deliveryWhenLabel, shortDeliveryReference } from '../../domain/deliveryCard';
import { deliveryStatusLabel } from '../../domain/deliveryStatus';
import { isMarketplaceDelivery } from '../../domain/marketplaceTracking';
import { riderSearchView } from '../../domain/riderSearchView';
import MarketplaceDelivery from '../components/MarketplaceDelivery';
import RiderSearchAnimation from '../components/RiderSearchAnimation';
import { useDeliveryTracking } from '../viewmodels/useDeliveryTracking';

type DeliveryTrackingProps = NativeStackScreenProps<RootStackParamList, 'DeliveryTracking'>;

const TITLES = {
  loading: 'Track Delivery',
  searching: 'Finding a rider',
  assigned: 'Rider assigned',
  'no-rider': 'No rider found',
  offline: 'Track Delivery',
  details: 'Track Delivery',
} as const;

export default function DeliveryTrackingScreen({ route, navigation }: DeliveryTrackingProps) {
  const { accessToken } = useSession();
  const { delivery, isLoading, error, reload, cancelling, cancelError, cancelSearch } = useDeliveryTracking(accessToken, route.params.deliveryId);
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [searchingAgain, setSearchingAgain] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mapUri, setMapUri] = useState<string | null>(null);
  const view = riderSearchView({
    hasDelivery: Boolean(delivery),
    isLoading,
    status: delivery?.status ?? null,
    error,
  });

  useLayoutEffect(() => {
    if (isMarketplaceDelivery(delivery)) {
      navigation.setOptions({ title: delivery?.status === 'CREATED' ? 'Rider bids' : deliveryStatusLabel(delivery?.status ?? 'CREATED') });
      return;
    }
    navigation.setOptions({ title: TITLES[view] });
  }, [navigation, view, delivery]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const deliveryId = delivery?.id ?? null;
  const mapCoordinates = delivery ? deliveryHasMapCoordinates(delivery) : false;
  useEffect(() => {
    if (!mapCoordinates) {
      setMapUri(null);
    }
    if (view !== 'searching' || !accessToken || !deliveryId || !mapCoordinates) {
      return;
    }
    let current = true;
    loadDeliveryMapImage(accessToken, deliveryId).then((uri) => {
      if (current) {
        setMapUri(uri);
      }
    }).catch(() => undefined);
    return () => {
      current = false;
    };
  }, [accessToken, deliveryId, mapCoordinates, view]);

  function confirmCancelSearch() {
    if (cancelling) {
      return;
    }
    Alert.alert(
      'Cancel this search?',
      'We will stop looking for a rider.',
      [
        { text: 'Keep searching', style: 'cancel' },
        {
          text: 'Cancel search',
          style: 'destructive',
          onPress: () => {
            void stopSearch();
          },
        },
      ],
    );
  }

  async function stopSearch() {
    const cancelled = await cancelSearch();
    if (cancelled) {
      navigation.navigate('CustomerHome', { screen: 'Requests' });
    }
  }

  function confirmDelete() {
    if (!delivery || deleting) {
      return;
    }
    Alert.alert(
      'Delete this delivery?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteDelivery();
          },
        },
      ],
    );
  }

  async function deleteDelivery() {
    if (!delivery || deleting) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await cancelCustomerDelivery(customerDeliveryRepository, accessToken, delivery.id);
      navigation.navigate('CustomerHome', { screen: 'Requests' });
    } catch (caught: unknown) {
      setActionError(errorMessage(caught, 'This delivery could not be deleted.'));
      setDeleting(false);
    }
  }

  async function searchAgain() {
    if (!accessToken || !delivery || searchingAgain || isMarketplaceDelivery(delivery)) {
      return;
    }
    setSearchingAgain(true);
    setActionError(null);
    try {
      await customerDeliveryRepository.search(accessToken, delivery.id);
      reload();
    } catch (caught: unknown) {
      setActionError(errorMessage(caught, 'The search could not be started.'));
    } finally {
      setSearchingAgain(false);
    }
  }

  if (isMarketplaceDelivery(delivery) && delivery) {
    return (
      <MarketplaceDelivery
        delivery={delivery}
        accessToken={accessToken}
        loadError={error}
        onRefreshDelivery={reload}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <GreenSurface
          style={styles.band}
          fadeColors={
            view === 'searching' && mapUri
              ? ['rgba(255,255,255,0.92)', colors.background]
              : undefined
          }
        >
          {view === 'searching' && mapUri ? (
            <>
              <Image source={{ uri: mapUri }} resizeMode="cover" style={styles.map} />
              <LinearGradient
                colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.92)']}
                style={styles.mapWash}
              />
            </>
          ) : null}
          <View style={styles.heroBody}>
          {view === 'loading' ? <LoadingIndicator /> : null}
          {view === 'searching' ? <RiderSearchAnimation active={focused && appActive} /> : null}
          {view === 'assigned' ? <StatusIcon name="motorbike" /> : null}
          {view === 'no-rider' ? <StatusIcon name="clock-outline" /> : null}
          {view === 'offline' ? <StatusIcon name="wifi-off" /> : null}
          {view === 'details' && delivery ? <StatusIcon name="package-variant" /> : null}
          {view !== 'loading' ? <Text style={styles.title}>{headline(view, delivery)}</Text> : null}
          {view !== 'loading' ? <Text style={styles.support}>{support(view)}</Text> : null}
          {view === 'searching' ? (
            <View style={styles.pill}>
              <View style={styles.dot} />
              <Text style={styles.pillText}>Searching for riders</Text>
            </View>
          ) : null}
          <ErrorMessage message={error ?? actionError ?? cancelError} />
          </View>
        </GreenSurface>
        {delivery ? (
          <View style={styles.overlap}>
            <Summary delivery={delivery} />
          </View>
        ) : null}
        {view === 'no-rider' ? (
          <View style={styles.footer}>
            <PrimaryButton
              label="Search again"
              icon="magnify"
              loading={searchingAgain}
              loadingLabel="Searching"
              onPress={() => {
                void searchAgain();
              }}
            />
            <SecondaryButton
              label="Delete"
              icon="delete-outline"
              tone="danger"
              loading={deleting}
              onPress={confirmDelete}
            />
          </View>
        ) : null}
        {view === 'searching' ? (
          <View style={styles.footer}>
            <SecondaryButton
              label="Cancel search"
              icon="close"
              tone="danger"
              loading={cancelling}
              onPress={confirmCancelSearch}
            />
          </View>
        ) : null}
        {view === 'searching' ? (
          <Text style={styles.leave}>
            You can leave this screen while we search. Check Deliveries for updates.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function headline(
  view: ReturnType<typeof riderSearchView>,
  delivery: CustomerDeliveryDetail | null,
): string {
  if (view === 'searching') {
    return 'Looking for your rider';
  }
  if (view === 'assigned') {
    return 'Rider assigned';
  }
  if (view === 'no-rider') {
    return 'No rider found';
  }
  if (view === 'offline') {
    return 'Connection problem';
  }
  return delivery ? deliveryStatusLabel(delivery.status) : 'Track Delivery';
}

function support(view: ReturnType<typeof riderSearchView>): string {
  if (view === 'searching') {
    return 'We\'re checking for available motorcycle riders who can collect your parcel.';
  }
  if (view === 'assigned') {
    return 'A rider accepted this delivery.';
  }
  if (view === 'no-rider') {
    return 'No rider was available for this delivery.';
  }
  if (view === 'offline') {
    return 'The search status could not be refreshed.';
  }
  return 'This is the latest status from your delivery.';
}

function StatusIcon({ name }: { name: 'motorbike' | 'clock-outline' | 'wifi-off' | 'package-variant' }) {
  return (
    <View style={styles.statusIcon}>
      <MaterialDesignIcons name={name} size={28} color={colors.primaryDark} />
    </View>
  );
}

function Summary({ delivery }: { delivery: CustomerDeliveryDetail }) {
  const when = delivery.createdAt ? deliveryWhenLabel(delivery.createdAt) : '';
  return (
    <View style={styles.card}>
      <View style={styles.facts}>
        <View style={styles.referenceRow}>
          <Text style={styles.metaLabel}>Delivery</Text>
          <Text style={styles.reference}>{shortDeliveryReference(delivery.id)}</Text>
        </View>
        {when ? (
          <View style={styles.referenceRow}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.reference}>{when}</Text>
          </View>
        ) : null}
      </View>
      <RouteStop label="Pickup" value={deliveryCardAddress(delivery.pickupAddress)} pin={colors.primary} badge={colors.primaryLight} connected />
      <RouteStop label="Destination" value={deliveryCardAddress(delivery.dropoffAddress)} pin={colors.error} badge="#FDECEC" connected={false} />
      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Price</Text>
          <Text style={styles.price}>{delivery.currency} {delivery.offeredPrice ?? delivery.suggestedPrice}</Text>
        </View>
        {delivery.distanceMeters > 0 ? (
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Distance</Text>
            <Text style={styles.metaValue}>{formatDistance(delivery.distanceMeters)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const PIN_SIZE = 32;
const DOT_SIZE = 3;
const DOT_STEP = 7;

function RouteStop({
  label,
  value,
  pin,
  badge,
  connected,
}: {
  label: string;
  value: string;
  pin: string;
  badge: string;
  connected: boolean;
}) {
  return (
    <View style={styles.stop}>
      <View style={styles.markerColumn}>
        <View style={[styles.pinCircle, { backgroundColor: badge }]}>
          <MaterialDesignIcons name="map-marker" color={pin} size={18} />
        </View>
        {connected ? <DottedConnector /> : null}
      </View>
      <View style={styles.stopCopy}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.stopValue}>{value}</Text>
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
        <View key={index} style={styles.dotMarker} />
      ))}
    </View>
  );
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters} m`;
  }
  const kilometres = meters / 1000;
  const text = kilometres >= 10 ? String(Math.round(kilometres)) : kilometres.toFixed(1);
  return `${text} km`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.lg,
  },
  band: {
    overflow: 'hidden',
    paddingBottom: spacing.xl,
  },
  heroBody: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  mapWash: {
    ...StyleSheet.absoluteFill,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  support: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  pillText: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    marginTop: spacing.sm,
  },
  leave: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  overlap: {
    marginTop: -spacing.xxxl,
    marginHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0 8px 24px rgba(23, 33, 29, 0.08)',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  facts: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  referenceRow: {
    flex: 1,
    gap: spacing.xs,
  },
  reference: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
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
    bottom: -spacing.sm,
    width: PIN_SIZE,
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  dotMarker: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: '#B7C2BC',
  },
  stopCopy: {
    flex: 1,
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  stopValue: {
    fontSize: typography.body,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
  },
  meta: {
    flexDirection: 'row',
    gap: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  metaItem: {
    flex: 1,
    gap: spacing.xs,
  },
  metaLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  metaValue: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.text,
  },
  price: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  footer: {
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
});
