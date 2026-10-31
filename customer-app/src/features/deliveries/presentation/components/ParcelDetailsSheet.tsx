import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheetModal from '../../../../components/BottomSheetModal';
import SecondaryButton from '../../../../components/SecondaryButton';
import { colors, radius, spacing, typography } from '../../../../theme';
import { deliveryCardAddress, deliveryContentKind, deliveryWhenLabel, shortDeliveryReference } from '../../domain/deliveryCard';
import { displayedCustomerOffer, type CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { ContentIcon, ContentLabel, LocationPin, ServiceClassBadge, StopLabel } from '../deliveryIcons';

type ParcelDetailsSheetProps = {
  delivery: CustomerDeliveryDetail | null;
  onClose: () => void;
  cancelling?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
};

export default function ParcelDetailsSheet({
  delivery,
  onClose,
  cancelling = false,
  onCancel,
  cancelLabel = 'Cancel request',
}: ParcelDetailsSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <BottomSheetModal visible={delivery !== null} onClose={onClose} closeLabel="Close parcel details">
        {delivery ? (
          <View style={[styles.sheet, styles.sheetTop, { paddingBottom: spacing.lg + insets.bottom }]}>
            <Summary delivery={delivery} framed={false} />
            {onCancel ? (
              <>
                <LinearGradient
                  colors={['transparent', colors.border, 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.actionDivider}
                />
                <SecondaryButton
                  label={cancelLabel}
                  tone="danger"
                  loading={cancelling}
                  bordered={false}
                  onPress={onCancel}
                />
              </>
            ) : null}
          </View>
        ) : null}
    </BottomSheetModal>
  );
}

export function Summary({
  delivery,
  framed = true,
  customerOffer = false,
  offerAmount,
  onAdjustPrice,
}: {
  delivery: CustomerDeliveryDetail;
  framed?: boolean;
  customerOffer?: boolean;
  offerAmount?: string;
  onAdjustPrice?: () => void;
}) {
  const when = delivery.createdAt ? deliveryWhenLabel(delivery.createdAt) : '';
  const contentKind = deliveryContentKind(delivery.parcelDescription);
  const amount = customerOffer
    ? (offerAmount ?? displayedCustomerOffer(delivery))
    : (delivery.offeredPrice ?? delivery.suggestedPrice);
  const price = `${delivery.currency} ${amount}`;
  return (
    <View style={framed ? styles.card : styles.sheetSummary}>
      <View style={styles.badgeRow}>
        <View style={styles.contentBadge}>
          <ContentIcon kind={contentKind} />
          <ContentLabel kind={contentKind} />
        </View>
        <ServiceClassBadge serviceClass={delivery.serviceClass} />
      </View>
      {framed || when ? (
        <View style={styles.facts}>
          {framed ? (
            <View style={styles.referenceRow}>
              <Text style={styles.metaLabel}>Delivery</Text>
              <Text style={styles.reference}>{shortDeliveryReference(delivery.id)}</Text>
            </View>
          ) : null}
          {when ? (
            <View style={styles.referenceRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text style={styles.reference}>{when}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <RouteStop label="Pickup" value={deliveryCardAddress(delivery.pickupAddress)} connected />
      <RouteStop label="Drop-off" value={deliveryCardAddress(delivery.dropoffAddress)} dropoff connected={false} />
      <LinearGradient
        colors={['transparent', colors.border, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.divider}
      />
      <View style={[styles.meta, customerOffer && styles.offerMeta]}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Distance</Text>
          <Text style={styles.metaValue}>{formatDistance(delivery.distanceMeters)}</Text>
        </View>
        <View style={styles.priceItem}>
          <Text style={styles.metaLabel}>{customerOffer ? 'Your offer' : 'Price'}</Text>
          <Text style={styles.price}>{price}</Text>
          {customerOffer && onAdjustPrice ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Adjust price"
              onPress={onAdjustPrice}
              style={styles.adjustPrice}
            >
              <MaterialDesignIcons name="pencil" size={14} color={colors.primary} />
              <Text style={styles.adjustPriceText}>Adjust price</Text>
            </Pressable>
          ) : null}
        </View>
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
  dropoff = false,
  connected,
}: {
  label: string;
  value: string;
  dropoff?: boolean;
  connected: boolean;
}) {
  return (
    <View style={styles.stop}>
      <View style={styles.markerColumn}>
        <View style={styles.pinCircle}>
          <LocationPin dropoff={dropoff} />
        </View>
        {connected ? <DottedConnector /> : null}
      </View>
      <View style={styles.stopCopy}>
        <StopLabel>{label}</StopLabel>
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
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetTop: {
    overflow: 'hidden',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  sheetSummary: {
    gap: spacing.sm,
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
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  contentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
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
    fontSize: typography.caption,
    lineHeight: 20,
    fontWeight: '400',
    color: colors.text,
  },
  divider: {
    height: 1,
    marginTop: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: -spacing.sm,
  },
  offerMeta: {
    alignItems: 'flex-start',
  },
  actionDivider: {
    height: 1,
  },
  metaItem: {
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  priceItem: {
    gap: spacing.xs,
    alignItems: 'flex-end',
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
  adjustPrice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  adjustPriceText: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.primary,
  },
});
