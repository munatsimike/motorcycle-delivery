import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import ErrorMessage from '../../../../components/ErrorMessage';
import { colors, radius, spacing, typography } from '../../../../theme';
import CollectedRouteMap from './CollectedRouteMap';
import DeliveryDetailFrame from './DeliveryDetailFrame';
import type { CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { deliveryStatusLabel, type DeliveryStatus } from '../../domain/deliveryStatus';
import { deliveryStatusTone } from '../deliveryStatusTone';
import { TRACKING_SHEET_OVERLAP } from '../../domain/trackingCamera';
import {
  assignedRiderPhotoPath,
  riderDialUrl,
  riderInitials,
  riderWhatsAppCallUrl,
} from '../../domain/trackingJourney';
import ParcelDetailsSheet, { Summary } from './ParcelDetailsSheet';
import RiderPortrait from './RiderPortrait';

type DeliveryOutcomeProps = {
  delivery: CustomerDeliveryDetail;
  message?: string | null;
  children?: ReactNode;
  customerOffer?: boolean;
  offerAmount?: string;
  onAdjustPrice?: () => void;
  accessToken?: string | null;
  onBack: () => void;
};

export default function DeliveryOutcome({
  delivery,
  message,
  children,
  customerOffer = false,
  offerAmount,
  onAdjustPrice,
  accessToken = null,
  onBack,
}: DeliveryOutcomeProps) {
  const rider = showsOutcomeRider(delivery.status) ? delivery.rider : null;
  const inTransit = deliveryOutcomeTitle(delivery.status) === 'In transit';
  const delivered = delivery.status === 'DELIVERED';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const route = collectedRoute(delivery);
  const phone = rider?.phone ?? null;
  const cancelled = delivery.status === 'CANCELLED';
  const statusTone = deliveryStatusTone(delivery.status);
  function callRider() {
    const url = riderDialUrl(phone);
    if (url) {
      void Linking.openURL(url);
    }
  }
  function callWhatsApp() {
    const url = riderWhatsAppCallUrl(phone);
    if (url) {
      void Linking.openURL(url);
    }
  }
  useEffect(() => {
    setDetailsOpen(false);
  }, [delivery.id]);
  return (
    <>
    <DeliveryDetailFrame
      onBack={onBack}
      topOutline
      overlap={route ? TRACKING_SHEET_OVERLAP : undefined}
      header={route ? (
        <CollectedRouteMap
          deliveryId={delivery.id}
          accessToken={accessToken}
          pickup={route.pickup}
          dropoff={route.dropoff}
        />
      ) : undefined}
    >
        <View style={styles.sheet}>
          <View style={styles.statusRow}>
            <View style={[styles.icon, { backgroundColor: statusTone.background }]}>
              <MaterialDesignIcons
                name={outcomeIcon(delivery.status)}
                size={22}
                color={statusTone.color}
              />
            </View>
            <View style={styles.statusCopy}>
              <Text style={[styles.title, cancelled && styles.titleCancelled, { color: statusTone.color }]}>{deliveryOutcomeTitle(delivery.status)}</Text>
              <Text style={styles.support}>{outcomeSupport(delivery.status)}</Text>
            </View>
          </View>
          <ErrorMessage message={message ?? null} />
          {rider ? (
            <View style={styles.riderCard}>
              <RiderPortrait
                name={rider.name}
                initials={riderInitials(rider.name)}
                path={rider.hasProfilePhoto ? assignedRiderPhotoPath(delivery.id) : null}
                accessToken={accessToken}
                style={styles.riderAvatar}
                textStyle={styles.avatarText}
              />
              <View style={styles.riderCopy}>
                <Text style={styles.riderName}>{rider.name}</Text>
                {rider.motorcycle ? <Text style={styles.riderMeta}>{rider.motorcycle}</Text> : null}
              </View>
              {riderDialUrl(phone) ? (
                <View style={styles.riderActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Call ${rider.name}`} hitSlop={8} onPress={callRider} style={styles.riderAction}>
                    <MaterialDesignIcons name="phone-outline" size={20} color="#111111" />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`WhatsApp ${rider.name}`} hitSlop={8} onPress={callWhatsApp} style={styles.riderAction}>
                    <MaterialDesignIcons name="whatsapp" size={20} color="#111111" />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
          {inTransit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Parcel details"
              onPress={() => setDetailsOpen(true)}
              style={styles.parcelDetails}
            >
              <Text style={styles.parcelDetailsText}>Parcel details</Text>
              <MaterialDesignIcons name="chevron-up" size={18} color={colors.primary} />
            </Pressable>
          ) : (
            <Summary
              delivery={delivery}
              customerOffer={customerOffer}
              offerAmount={offerAmount}
              onAdjustPrice={onAdjustPrice}
              showDivider={!delivered}
            />
          )}
          {children ? <View style={styles.footer}>{children}</View> : null}
        </View>
    </DeliveryDetailFrame>
    {inTransit ? (
      <ParcelDetailsSheet
        delivery={detailsOpen ? delivery : null}
        onClose={() => setDetailsOpen(false)}
      />
    ) : null}
    </>
  );
}

function collectedRoute(delivery: CustomerDeliveryDetail): { pickup: { latitude: number; longitude: number }; dropoff: { latitude: number; longitude: number } } | null {
  if (delivery.status !== 'COLLECTED' && delivery.status !== 'PICKED_UP') {
    return null;
  }
  if (
    delivery.pickupLatitude === null
    || delivery.pickupLongitude === null
    || delivery.dropoffLatitude === null
    || delivery.dropoffLongitude === null
  ) {
    return null;
  }
  return {
    pickup: { latitude: delivery.pickupLatitude, longitude: delivery.pickupLongitude },
    dropoff: { latitude: delivery.dropoffLatitude, longitude: delivery.dropoffLongitude },
  };
}

function showsOutcomeRider(status: DeliveryStatus): boolean {
  return deliveryOutcomeTitle(status) === 'In transit' || status === 'DELIVERED';
}

export function deliveryOutcomeTitle(status: DeliveryStatus): string {
  if (
    status === 'PICKED_UP'
    || status === 'COLLECTED'
    || status === 'IN_TRANSIT'
    || status === 'ARRIVED_AT_DROPOFF'
    || status === 'OUT_FOR_DELIVERY'
  ) {
    return 'In transit';
  }
  return deliveryStatusLabel(status);
}

function outcomeSupport(status: DeliveryStatus): string {
  if (status === 'NO_RIDER_FOUND') {
    return 'No rider was available for this delivery.';
  }
  if (status === 'COLLECTED' || status === 'PICKED_UP') {
    return 'Your parcel has been collected. Delivery is in progress.';
  }
  if (status === 'OUT_FOR_DELIVERY' || status === 'IN_TRANSIT' || status === 'ARRIVED_AT_DROPOFF') {
    return 'Delivery is in progress.';
  }
  if (status === 'DELIVERED') {
    return 'This delivery is complete.';
  }
  if (status === 'CANCELLED') {
    return 'This delivery was cancelled.';
  }
  if (status === 'FAILED') {
    return 'This delivery could not be completed.';
  }
  return 'This is the latest status from your delivery.';
}

function outcomeIcon(status: DeliveryStatus): 'clock-outline' | 'check' | 'close' | 'alert-circle-outline' | 'package-variant-closed' {
  if (status === 'NO_RIDER_FOUND') {
    return 'clock-outline';
  }
  if (status === 'DELIVERED') {
    return 'check';
  }
  if (status === 'CANCELLED') {
    return 'close';
  }
  if (status === 'FAILED') {
    return 'alert-circle-outline';
  }
  return 'package-variant-closed';
}

const styles = StyleSheet.create({
  sheet: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  statusRow: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusCopy: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  titleCancelled: {
    fontWeight: '500',
  },
  support: {
    textAlign: 'center',
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  riderAvatar: {
    width: 48,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  avatarText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  riderCopy: {
    flex: 1,
    gap: 2,
  },
  riderName: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  riderMeta: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  riderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  riderAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
  footer: {
    gap: spacing.sm,
  },
});
