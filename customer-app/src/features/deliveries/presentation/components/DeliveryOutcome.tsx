import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import ErrorMessage from '../../../../components/ErrorMessage';
import GreenSurface from '../../../../components/GreenSurface';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { deliveryStatusLabel, type DeliveryStatus } from '../../domain/deliveryStatus';
import {
  assignedRiderPhotoPath,
  riderDialUrl,
  riderInitials,
  riderWhatsAppCallUrl,
} from '../../domain/trackingJourney';
import { Summary } from './ParcelDetailsSheet';
import RiderPortrait from './RiderPortrait';

type DeliveryOutcomeProps = {
  delivery: CustomerDeliveryDetail;
  message?: string | null;
  children?: ReactNode;
  customerOffer?: boolean;
  offerAmount?: string;
  onAdjustPrice?: () => void;
  accessToken?: string | null;
};

export default function DeliveryOutcome({
  delivery,
  message,
  children,
  customerOffer = false,
  offerAmount,
  onAdjustPrice,
  accessToken = null,
}: DeliveryOutcomeProps) {
  const rider = showsOutcomeRider(delivery.status) ? delivery.rider : null;
  const phone = rider?.phone ?? null;
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
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <GreenSurface style={styles.band}>
          <View style={styles.hero}>
            <View style={styles.icon}>
              <MaterialDesignIcons name={outcomeIcon(delivery.status)} size={28} color={colors.primaryDark} />
            </View>
            <Text style={styles.title}>{deliveryOutcomeTitle(delivery.status)}</Text>
            <Text style={styles.support}>{outcomeSupport(delivery.status)}</Text>
            <ErrorMessage message={message ?? null} />
          </View>
        </GreenSurface>
        <View style={styles.overlap}>
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
                  <Pressable accessibilityRole="button" accessibilityLabel={`Call ${rider.name}`} hitSlop={8} onPress={callRider}>
                    <MaterialDesignIcons name="phone-outline" size={22} color={colors.text} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`WhatsApp ${rider.name}`} hitSlop={8} onPress={callWhatsApp}>
                    <MaterialDesignIcons name="whatsapp" size={22} color={colors.text} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
          <Summary
            delivery={delivery}
            customerOffer={customerOffer}
            offerAmount={offerAmount}
            onAdjustPrice={onAdjustPrice}
          />
        </View>
        {children ? <View style={styles.footer}>{children}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
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
    paddingBottom: 0,
  },
  hero: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    marginTop: spacing.sm,
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
  overlap: {
    marginTop: -spacing.xxxl,
    marginHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
    gap: spacing.md,
  },
  footer: {
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});
