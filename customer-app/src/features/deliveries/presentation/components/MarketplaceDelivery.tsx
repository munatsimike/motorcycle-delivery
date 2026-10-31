import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import { colors, radius, spacing, typography } from '../../../../theme';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { formatDeadline } from '../../domain/bookingDraft';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { cancelCustomerDelivery } from '../../domain/usecases/cancelCustomerDelivery';
import { keepsRiderLocation, type CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { deliveryStatusLabel } from '../../domain/deliveryStatus';
import {
  customerCanCancelDelivery,
  riderDialUrl,
  riderWhatsAppCallUrl,
  assignedRiderPhotoPath,
  riderInitials,
  shouldShowAssignmentNotice,
  trackingHeadline,
} from '../../domain/trackingJourney';
import RiderPortrait from './RiderPortrait';
import { trackingMapView } from '../../domain/marketplaceTracking';
import { arrivalLabel, roadDistanceLabel } from '../../domain/trackingDisplay';
import ParcelDetailsSheet from './ParcelDetailsSheet';
import RiderLocationMap from './RiderLocationMap';
import { TRACKING_SHEET_OVERLAP } from '../../domain/trackingCamera';

type MarketplaceDeliveryProps = {
  delivery: CustomerDeliveryDetail;
  accessToken: string | null;
  loadError: string | null;
  pendingRiderName?: string | null;
  showRiderConfirmation?: boolean;
  onContinueConfirmation?: () => void;
  onRefreshDelivery: () => void;
};

export default function MarketplaceDelivery({
  delivery,
  accessToken,
  loadError,
  pendingRiderName = null,
  showRiderConfirmation = false,
  onContinueConfirmation,
  onRefreshDelivery,
}: MarketplaceDeliveryProps) {
  const focused = useIsFocused();
  const [cancelling, setCancelling] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const tracking = keepsRiderLocation(delivery.status);
  const now = useTrackingClock(focused && tracking);
  const mapView = trackingMapView(delivery, now);
  const live = mapView.kind === 'live';
  const showMap = mapView.kind !== 'hidden';
  const approach = live ? delivery.pickupApproach : null;
  const headline = trackingHeadline(delivery.status, approach?.metres);
  const distanceText = approach ? roadDistanceLabel(approach.metres) : null;
  const arrivalText = approach ? arrivalLabel(approach.seconds) : null;
  const showNotice = shouldShowAssignmentNotice(showRiderConfirmation);
  const deadline = delivery.deliverBy ? formatDeadline(delivery.deliverBy) : null;

  useEffect(() => {
    setDetailsOpen(false);
  }, [delivery.id]);

  function dismissNotice() {
    onContinueConfirmation?.();
  }

  function callRider() {
    const url = riderDialUrl(delivery.rider?.phone ?? null);
    if (!url) {
      return;
    }
    void Linking.openURL(url);
  }

  function callWhatsApp() {
    const url = riderWhatsAppCallUrl(delivery.rider?.phone ?? null);
    if (!url) {
      return;
    }
    void Linking.openURL(url);
  }

  function confirmCancel() {
    if (cancelling || !customerCanCancelDelivery(delivery.status)) {
      return;
    }
    Alert.alert(
      'Cancel delivery?',
      'Cancelling closes this delivery request.',
      [
        { text: 'Keep delivery', style: 'cancel' },
        {
          text: 'Cancel delivery',
          style: 'destructive',
          onPress: () => {
            setDetailsOpen(false);
            void cancelDelivery();
          },
        },
      ],
    );
  }

  async function cancelDelivery() {
    if (!accessToken || cancelling) {
      return;
    }
    setCancelling(true);
    setActionError(null);
    try {
      await cancelCustomerDelivery(customerDeliveryRepository, accessToken, delivery.id);
      onRefreshDelivery();
    } catch (caught: unknown) {
      setActionError(errorMessage(caught, 'This delivery could not be cancelled.'));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        removeClippedSubviews={false}
        refreshControl={(
          <RefreshControl refreshing={false} onRefresh={onRefreshDelivery} tintColor={colors.primary} colors={[colors.primary]} />
        )}
      >
        {mapView.kind === 'live' ? (
          <RiderLocationMap
            deliveryId={mapView.deliveryId}
            live
            rider={mapView.rider}
            pickup={mapView.pickup}
            line={approach?.line ?? []}
            distanceLabel={distanceText}
          />
        ) : mapView.kind === 'awaiting' ? (
          <RiderLocationMap
            deliveryId={mapView.deliveryId}
            live={false}
            rider={null}
            pickup={mapView.pickup}
            line={[]}
            distanceLabel={null}
          />
        ) : null}
        <View pointerEvents="box-none" style={showMap ? styles.sheet : undefined}>
          {showMap ? (
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0)', colors.background]}
              locations={[0, 0.42, 1]}
              style={styles.sheetFade}
            />
          ) : null}
          <View style={[styles.inset, showMap ? styles.insetOnMap : null]}>
          {delivery.serviceClass === 'EXPRESS' ? <Text style={styles.kicker}>Urgent</Text> : null}
          {headline ? (
            <View style={styles.statusRow}>
              <Text style={styles.statusTitle}>{headline}</Text>
              {live ? <Text style={styles.live}>Live</Text> : null}
            </View>
          ) : (
            <Text style={styles.title}>{deliveryStatusLabel(delivery.status)}</Text>
          )}
          {pendingRiderName && !delivery.rider ? <Text style={styles.body}>{pendingRiderName} is assigned to this delivery.</Text> : null}
          {deadline ? <Text style={styles.body}>Deliver by {deadline}</Text> : null}
          {!delivery.offeredPrice ? (
            <Text style={styles.note}>Riders bid their own price. This suggestion is not the agreed price.</Text>
          ) : null}
          {delivery.rider && headline ? (
            <View style={styles.riderRow}>
              <RiderPortrait
                name={delivery.rider.name}
                initials={riderInitials(delivery.rider.name)}
                path={delivery.rider.hasProfilePhoto ? assignedRiderPhotoPath(delivery.id) : null}
                accessToken={accessToken}
                style={styles.riderAvatar}
                textStyle={styles.avatarText}
              />
              <View style={styles.riderCopy}>
                <Text style={styles.factValue}>{delivery.rider.name}</Text>
                {delivery.rider.motorcycle ? <Text style={styles.note}>{delivery.rider.motorcycle}</Text> : null}
              </View>
              {riderDialUrl(delivery.rider.phone) ? (
                <View style={styles.riderActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Call ${delivery.rider.name}`} hitSlop={8} onPress={callRider}>
                    <MaterialDesignIcons name="phone-outline" size={22} color="#000000" />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`WhatsApp ${delivery.rider.name}`} hitSlop={8} onPress={callWhatsApp}>
                    <MaterialDesignIcons name="whatsapp" size={22} color="#000000" />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
          {delivery.rider && headline && live ? (
            <LinearGradient
              colors={['transparent', colors.border, 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.divider}
            />
          ) : null}
          {live ? (
            <View style={styles.metrics}>
              <View style={styles.metric}>
                <View style={styles.metricLabelRow}>
                  <MaterialDesignIcons name="map-marker-distance" size={16} color={colors.textSecondary} />
                  <Text style={styles.metricLabel}>Distance</Text>
                </View>
                <Text style={styles.metricValue}>{distanceText ?? 'Unavailable'}</Text>
              </View>
              <View style={styles.metric}>
                <View style={styles.metricLabelRow}>
                  <MaterialDesignIcons name="clock-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.metricLabel}>Time</Text>
                </View>
                <Text style={styles.metricValue}>{arrivalText ?? 'Unavailable'}</Text>
              </View>
            </View>
          ) : null}
          <LinearGradient
            colors={['transparent', colors.border, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.divider}
          />
          <View style={styles.footerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Parcel details"
              onPress={() => setDetailsOpen(true)}
              style={styles.parcelDetails}
            >
              <Text style={styles.parcelDetailsText}>Parcel details</Text>
              <MaterialDesignIcons name="chevron-up" size={18} color={colors.primary} />
            </Pressable>
          </View>
          {headline && !customerCanCancelDelivery(delivery.status) && delivery.status !== 'DELIVERED' && delivery.status !== 'CANCELLED' ? (
            <Text style={styles.note}>This parcel has been collected. Ordinary cancellation is no longer available.</Text>
          ) : null}
          <ErrorMessage message={actionError ?? loadError} />
          </View>
        </View>
      </ScrollView>
      <ParcelDetailsSheet
        delivery={detailsOpen ? delivery : null}
        onClose={() => setDetailsOpen(false)}
        cancelling={cancelling}
        cancelLabel="Cancel delivery"
        onCancel={customerCanCancelDelivery(delivery.status) ? confirmCancel : undefined}
      />
      <Modal visible={showNotice} transparent animationType="fade" onRequestClose={dismissNotice}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmBadge}>
              <MaterialDesignIcons name="check" size={32} color={colors.primary} />
            </View>
            <Text style={styles.confirmTitle}>Rider confirmed!</Text>
            <Text style={styles.confirmBody}>Your rider has been assigned to your delivery.</Text>
            <View style={styles.confirmAction}>
              <PrimaryButton label="Continue" onPress={dismissNotice} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function useTrackingClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  inset: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  sheet: {
    marginTop: -TRACKING_SHEET_OVERLAP,
  },
  sheetFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  insetOnMap: {
    paddingTop: 108 + spacing.lg,
  },
  confirmBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(23, 33, 29, 0.4)',
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
  },
  confirmBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  confirmTitle: {
    textAlign: 'center',
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  confirmBody: {
    textAlign: 'center',
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  confirmAction: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusTitle: {
    flex: 1,
    fontSize: typography.heading,
    fontWeight: '600',
    color: colors.text,
  },
  live: {
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
    color: colors.primaryDark,
    fontSize: typography.small,
    fontWeight: '700',
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
    gap: spacing.xs,
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  metricValue: {
    fontSize: typography.body,
    fontWeight: '500',
    color: colors.text,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  parcelDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.xs,
  },
  parcelDetailsText: {
    fontSize: typography.button,
    fontWeight: '500',
    color: colors.primary,
  },
  riderAvatar: {
    width: 48,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  riderCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  divider: {
    height: 1,
  },
  riderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  kicker: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: '#000000',
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '800',
    color: colors.text,
  },
  body: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  factValue: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  note: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
