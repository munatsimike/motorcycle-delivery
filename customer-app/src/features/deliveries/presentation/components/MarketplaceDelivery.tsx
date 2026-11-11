import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useIsFocused } from '@react-navigation/native';

import DialogModal, { DialogActions, DialogBody, DialogTextButton, DialogTitle } from '../../../../components/DialogModal';
import ErrorMessage from '../../../../components/ErrorMessage';
import { colors, radius, spacing, typography } from '../../../../theme';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { formatDeadline } from '../../domain/bookingDraft';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { cancelCustomerDelivery } from '../../domain/usecases/cancelCustomerDelivery';
import { keepsRiderLocation, type CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { deliveryStatusLabel } from '../../domain/deliveryStatus';
import { deliveryStatusTone } from '../deliveryStatusTone';
import {
  customerCanCancelDelivery,
  riderDialUrl,
  riderWhatsAppCallUrl,
  assignedRiderPhotoPath,
  riderBikeLine,
  riderInitials,
  ASSIGNMENT_NOTICE_MS,
  assignmentNoticeVisible,
  shouldShowAssignmentNotice,
  trackingHeadline,
  trackingSubtitle,
} from '../../domain/trackingJourney';
import RiderPortrait from './RiderPortrait';
import { trackingMapView } from '../../domain/marketplaceTracking';
import { TRACKING_SHEET_OVERLAP } from '../../domain/trackingCamera';
import { arrivalLabel, roadDistanceLabel } from '../../domain/trackingDisplay';
import DeliveryDetailFrame from './DeliveryDetailFrame';
import ParcelDetailsSheet from './ParcelDetailsSheet';
import RiderLocationMap from './RiderLocationMap';

type MarketplaceDeliveryProps = {
  delivery: CustomerDeliveryDetail;
  accessToken: string | null;
  loadError: string | null;
  pendingRiderName?: string | null;
  showRiderConfirmation?: boolean;
  onContinueConfirmation?: () => void;
  onRefreshDelivery: () => void;
  refreshing: boolean;
  onBack: () => void;
};

export default function MarketplaceDelivery({
  delivery,
  accessToken,
  loadError,
  pendingRiderName = null,
  showRiderConfirmation = false,
  onContinueConfirmation,
  onRefreshDelivery,
  refreshing,
  onBack,
}: MarketplaceDeliveryProps) {
  const focused = useIsFocused();
  const [cancelling, setCancelling] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const tracking = keepsRiderLocation(delivery.status);
  const now = useTrackingClock(focused && tracking);
  const mapView = trackingMapView(delivery, now);
  const live = mapView.kind === 'live';
  const approach = live ? delivery.pickupApproach : null;
  const headline = trackingHeadline(delivery.status, approach?.metres);
  const statusTone = deliveryStatusTone(delivery.status);
  const bikeLine = delivery.rider ? riderBikeLine(delivery.rider.motorcycle, delivery.rider.registrationNumber) : null;
  const subtitle = trackingSubtitle(headline, delivery.dropoffAddress);
  const distanceText = approach ? roadDistanceLabel(approach.metres) : null;
  const arrivalText = approach ? arrivalLabel(approach.seconds) : null;
  const [noticeElapsed, setNoticeElapsed] = useState(ASSIGNMENT_NOTICE_MS);
  const dismissNotice = useRef(onContinueConfirmation);
  dismissNotice.current = onContinueConfirmation;
  const showNotice = assignmentNoticeVisible(showRiderConfirmation, noticeElapsed);
  const deadline = delivery.deliverBy ? formatDeadline(delivery.deliverBy) : null;

  useEffect(() => {
    if (!shouldShowAssignmentNotice(showRiderConfirmation)) {
      setNoticeElapsed(ASSIGNMENT_NOTICE_MS);
      return undefined;
    }
    setNoticeElapsed(0);
    const timer = setTimeout(() => {
      setNoticeElapsed(ASSIGNMENT_NOTICE_MS);
      dismissNotice.current?.();
    }, ASSIGNMENT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [showRiderConfirmation]);

  useEffect(() => {
    setDetailsOpen(false);
  }, [delivery.id]);

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
    setDetailsOpen(false);
    setCancelOpen(true);
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

  const mapHeader = mapView.kind === 'live' ? (
    <RiderLocationMap
      deliveryId={mapView.deliveryId}
      live
      rider={mapView.rider}
      stop={mapView.stop}
      headingToDropoff={mapView.headingToDropoff}
      line={approach?.line ?? []}
      distanceLabel={distanceText}
      etaLabel={arrivalText}
    />
  ) : mapView.kind === 'awaiting' ? (
    <RiderLocationMap
      deliveryId={mapView.deliveryId}
      live={false}
      rider={null}
      stop={mapView.stop}
      headingToDropoff={mapView.headingToDropoff}
      line={[]}
      distanceLabel={null}
      etaLabel={null}
    />
  ) : undefined;

  return (
    <View style={styles.screen}>
      <DeliveryDetailFrame
        onBack={onBack}
        header={mapHeader}
        overlap={TRACKING_SHEET_OVERLAP}
        hugSheet
        topOutline
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={onRefreshDelivery} tintColor={colors.primary} colors={[colors.primary]} />
        )}
      >
          <View style={styles.inset}>
          {showNotice ? (
            <View style={styles.confirmNote}>
              <View style={styles.confirmMark}>
                <MaterialDesignIcons name="check" size={18} color={colors.primaryDark} />
              </View>
              <View style={styles.confirmCopy}>
                <Text style={styles.confirmTitle}>Rider confirmed!</Text>
                <Text style={styles.confirmBody}>Your rider has been assigned to your delivery.</Text>
              </View>
            </View>
          ) : null}
          {delivery.serviceClass === 'EXPRESS' ? <Text style={styles.kicker}>Urgent</Text> : null}
          {headline ? (
            <View style={styles.statusHeading}>
              <View style={styles.statusRow}>
                <Text style={styles.statusTitle}>{headline}</Text>
                {live ? <Text style={styles.live}>Live</Text> : null}
              </View>
              {subtitle ? <Text style={styles.statusSubtitle}>{subtitle}</Text> : null}
            </View>
          ) : (
            <Text style={[styles.title, { color: statusTone.color }]}>{deliveryStatusLabel(delivery.status)}</Text>
          )}
          {pendingRiderName && !delivery.rider ? <Text style={styles.body}>{pendingRiderName} is assigned to this delivery.</Text> : null}
          {deadline ? <Text style={styles.body}>Deliver by {deadline}</Text> : null}
          {!delivery.offeredPrice ? (
            <Text style={styles.note}>Riders offer their own price. This suggestion is not the agreed price.</Text>
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
                {bikeLine ? <Text style={styles.note}>{bikeLine}</Text> : null}
                {delivery.rider.colour ? <Text style={styles.note}>{delivery.rider.colour}</Text> : null}
              </View>
              {riderDialUrl(delivery.rider.phone) ? (
                <View style={styles.riderActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Call ${delivery.rider.name}`} hitSlop={8} onPress={callRider} style={styles.contactAction}>
                    <MaterialDesignIcons name="phone-outline" size={22} color="#111111" />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`WhatsApp ${delivery.rider.name}`} hitSlop={8} onPress={callWhatsApp} style={styles.contactAction}>
                    <MaterialDesignIcons name="whatsapp" size={22} color="#111111" />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
          <LinearGradient
            colors={['transparent', colors.border, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.divider}
          />
          <View style={styles.footerRow}>
            {customerCanCancelDelivery(delivery.status) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel delivery"
                disabled={cancelling}
                hitSlop={8}
                onPress={confirmCancel}
              >
                <Text style={styles.cancelDelivery}>{cancelling ? 'Cancelling' : 'Cancel delivery'}</Text>
              </Pressable>
            ) : null}
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
          <ErrorMessage message={actionError ?? loadError} />
          </View>
      </DeliveryDetailFrame>
      <ParcelDetailsSheet
        delivery={detailsOpen ? delivery : null}
        onClose={() => setDetailsOpen(false)}
        cancelling={cancelling}
        cancelLabel="Cancel delivery"
        onCancel={customerCanCancelDelivery(delivery.status) ? confirmCancel : undefined}
      />
      <DialogModal visible={cancelOpen} onClose={() => setCancelOpen(false)} closeLabel="Keep delivery">
        <DialogTitle>Cancel delivery?</DialogTitle>
        <DialogBody>Cancelling closes this delivery request.</DialogBody>
        <DialogActions>
          <DialogTextButton label="Keep delivery" tone="neutral" onPress={() => setCancelOpen(false)} />
          <DialogTextButton
            label="Cancel delivery"
            tone="danger"
            weight="regular"
            onPress={() => {
              setCancelOpen(false);
              void cancelDelivery();
            }}
          />
        </DialogActions>
      </DialogModal>
    </View>
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
  inset: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  confirmNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
  },
  confirmMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  confirmCopy: {
    flex: 1,
    gap: 2,
  },
  confirmTitle: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  confirmBody: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.text,
  },
  statusHeading: {
    gap: 4,
  },
  statusSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
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
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cancelDelivery: {
    fontSize: typography.button,
    fontWeight: '400',
    color: colors.error,
  },
  parcelDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
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
  contactAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  kicker: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
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
