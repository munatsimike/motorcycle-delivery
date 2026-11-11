import { useRef } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheetModal from '../../../../components/BottomSheetModal';
import SecondaryButton from '../../../../components/SecondaryButton';
import { bottomContentInset, colors, radius, spacing, typography } from '../../../../theme';
import { deliveryCardAddress, deliveryContentKind, deliveryWhenLabel, shortDeliveryReference } from '../../domain/deliveryCard';
import { moneyLabel } from '../../domain/moneyLabel';
import { displayedCustomerOffer, type CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { ContentIcon, ContentLabel, LocationPin, ServiceClassBadge, deliveryIcon } from '../deliveryIcons';

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
  const window = useWindowDimensions();
  const dragY = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const open = delivery !== null;
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    dragY.setValue(0);
    scrollY.current = 0;
  }
  wasOpen.current = open;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => draggingDown(scrollY.current, gesture.dx, gesture.dy),
    onMoveShouldSetPanResponderCapture: (_, gesture) => draggingDown(scrollY.current, gesture.dx, gesture.dy),
    onPanResponderMove: (_, gesture) => {
      dragY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 72 || gesture.vy > 0.75) {
        closeRef.current();
        return;
      }
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
  })).current;
  return (
    <BottomSheetModal visible={open} onClose={onClose} closeLabel="Close parcel details">
        {delivery ? (
          <Animated.View style={[styles.sheet, styles.sheetTop, { paddingBottom: 0, transform: [{ translateY: dragY }] }]} {...pan.panHandlers}>
            <View style={styles.handleHit} accessibilityLabel="Drag down to close">
              <View style={styles.handle} />
            </View>
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: Math.round(window.height * 0.75) }}
              contentContainerStyle={[styles.sheetBody, { paddingBottom: bottomContentInset(insets.bottom) }]}
              onScroll={(event) => {
                scrollY.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
            >
              <Summary delivery={delivery} framed={false} showContacts />
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
                    weight="regular"
                    loading={cancelling}
                    bordered={false}
                    onPress={onCancel}
                  />
                </>
              ) : null}
            </ScrollView>
          </Animated.View>
        ) : null}
    </BottomSheetModal>
  );
}

function draggingDown(scrollOffset: number, dx: number, dy: number): boolean {
  return scrollOffset <= 0 && dy > 8 && Math.abs(dy) > Math.abs(dx);
}

export function Summary({
  delivery,
  framed = true,
  customerOffer = false,
  offerAmount,
  onAdjustPrice,
  showDivider = true,
  showContacts = false,
}: {
  delivery: CustomerDeliveryDetail;
  framed?: boolean;
  customerOffer?: boolean;
  offerAmount?: string;
  onAdjustPrice?: () => void;
  showDivider?: boolean;
  showContacts?: boolean;
}) {
  const when = delivery.createdAt ? deliveryWhenLabel(delivery.createdAt) : '';
  const reference = shortDeliveryReference(delivery.id);
  const contentKind = deliveryContentKind(delivery.parcelDescription);
  const amount = customerOffer
    ? (offerAmount ?? displayedCustomerOffer(delivery))
    : (delivery.offeredPrice ?? delivery.suggestedPrice);
  const price = moneyLabel(delivery.currency, amount ?? '');
  return (
    <View style={[framed ? styles.card : styles.sheetSummary, !showDivider && styles.evenSections]}>
      <View style={styles.badgeRow}>
        <View style={styles.contentBadge}>
          <ContentIcon kind={contentKind} />
          <ContentLabel kind={contentKind} />
        </View>
        <ServiceClassBadge serviceClass={delivery.serviceClass} />
        <Text style={styles.deliveryId} numberOfLines={1} accessibilityLabel={`Delivery reference ${reference}`}>{reference}</Text>
      </View>
      {when ? (
        <View style={styles.dateRow}>
          <MaterialDesignIcons name="calendar-outline" size={deliveryIcon.size} color={deliveryIcon.color} accessibilityLabel="Date" />
          <Text style={styles.dateText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{when}</Text>
        </View>
      ) : null}
      <View style={[styles.route, showContacts && styles.routeParties]}>
        <RouteStop
          role={showContacts ? 'Sender' : null}
          name={showContacts ? delivery.senderName : null}
          value={deliveryCardAddress(delivery.pickupAddress)}
        />
        <RouteStop
          role={showContacts ? 'Recipient' : null}
          name={showContacts ? delivery.recipientName : null}
          value={deliveryCardAddress(delivery.dropoffAddress)}
          dropoff
        />
      </View>
      {showDivider ? (
        <LinearGradient
          colors={['transparent', colors.border, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.divider}
        />
      ) : null}
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

const PIN_SIZE = deliveryIcon.size;

function RouteStop({
  value,
  name = null,
  role = null,
  dropoff = false,
}: {
  value: string;
  name?: string | null;
  role?: string | null;
  dropoff?: boolean;
}) {
  return (
    <View style={styles.stop}>
      <View style={styles.markerColumn}>
        <View style={styles.pinCircle}>
          <LocationPin dropoff={dropoff} />
        </View>
      </View>
      <View style={styles.stopCopy}>
        {role ? <Text style={styles.stopRole}>{role}</Text> : null}
        {name ? <Text style={styles.stopName}>{name}</Text> : null}
        <Text style={styles.stopValue}>{value}</Text>
      </View>
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
  sheetBody: {
    gap: spacing.sm,
  },
  handleHit: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textSecondary,
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
  evenSections: {
    gap: spacing.md,
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
    flexShrink: 0,
    gap: spacing.sm,
  },
  deliveryId: {
    marginLeft: 'auto',
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateText: {
    flex: 1,
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  route: {
    gap: spacing.md,
  },
  routeParties: {
    gap: spacing.lg,
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  markerColumn: {
    width: PIN_SIZE,
    alignItems: 'flex-start',
  },
  pinCircle: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  stopCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  stopRole: {
    fontSize: typography.small,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  stopName: {
    fontSize: typography.body,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.text,
  },
  stopValue: {
    fontSize: typography.body,
    lineHeight: 21,
    fontWeight: '400',
    color: colors.text,
  },
  divider: {
    height: 1,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
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
