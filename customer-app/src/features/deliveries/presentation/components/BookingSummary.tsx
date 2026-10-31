import { useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import LoadingIndicator from '../../../../components/LoadingIndicator';
import { useInputFocus } from '../../../../components/useInputFocus';
import { colors, radius, spacing, typography } from '../../../../theme';
import { deliveryContactPhone, type BookingDraft, type StopDraft } from '../../domain/bookingDraft';
import { deliveryCardAddress, deliveryContentKind } from '../../domain/deliveryCard';
import { ContentIcon, LocationPin, StopLabel, deliveryIcon } from '../deliveryIcons';
import type { DeliveryQuote } from '../../domain/deliveryQuote';
import { parcelSizeLabel, payerLabel, paymentMethodLabel } from './ParcelFields';

type BookingSummaryProps = {
  draft: BookingDraft;
  quote: DeliveryQuote | null;
  quoting: boolean;
  offerText: string;
  onOfferChange: (value: string) => void;
  offerEditable?: boolean;
  onOfferFocus?: () => void;
  marketplace?: boolean;
};

export default function BookingSummary({
  draft,
  quote,
  quoting,
  offerText,
  onOfferChange,
  offerEditable = true,
  onOfferFocus,
  marketplace = false,
}: BookingSummaryProps) {
  const offerFocus = useInputFocus();
  return (
    <View style={styles.wrap}>
      <View style={styles.route}>
        <RouteStop label="Pickup" stop={draft.pickup} last={false} />
        <RouteStop label="Drop-off" stop={draft.dropoff} last />
      </View>

      <View style={styles.facts}>
        <Fact
          label="Sending"
          value={describeParcel(draft)}
          mark={<ContentIcon kind={deliveryContentKind(draft.description)} />}
        />
        {marketplace ? (
          <Fact
            icon={draft.serviceClass === 'EXPRESS' ? 'flash-outline' : 'message-text-outline'}
            label="Delivery type"
            value={draft.serviceClass === 'EXPRESS' ? 'Urgent' : 'Flexible'}
          />
        ) : null}
        {marketplace ? null : (
          <Fact
            icon="account-group-outline"
            label="Pays"
            value={draft.payer ? payerLabel(draft.payer) : ''}
          />
        )}
        {draft.paymentMethod ? (
          <Fact
            icon={draft.paymentMethod === 'ECOCASH' ? 'cellphone' : 'cash'}
            label="Method"
            value={paymentMethodLabel(draft.paymentMethod)}
          />
        ) : null}
      </View>

      <View style={styles.priceCard}>
        {quoting ? <LoadingIndicator /> : null}
        {quote && !quoting ? (
          <View style={styles.priceBlock}>
            <View style={styles.priceRow}>
              <View style={styles.priceCopy}>
                <Text style={styles.priceLabel}>Suggested price</Text>
                <Text style={styles.price}>{quote.currency} {quote.suggestedPrice}</Text>
              </View>
              <View style={styles.distanceCopy}>
                <Text style={styles.priceLabel}>Distance</Text>
                <Text style={styles.distance}>{formatDistance(quote.distanceMeters)}</Text>
              </View>
            </View>
            <Text style={styles.offerLabel}>Your offer (USD)</Text>
            <View style={[styles.offerField, offerFocus.style]}>
              <Text style={styles.offerCurrency}>{quote.currency}</Text>
              <TextInput
                style={styles.offerInput}
                value={offerText}
                onChangeText={onOfferChange}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                maxLength={7}
                editable={offerEditable}
                onFocus={() => {
                  offerFocus.onFocus();
                  onOfferFocus?.();
                }}
                onBlur={offerFocus.onBlur}
              />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function RouteStop({ label, stop, last }: { label: string; stop: StopDraft; last: boolean }) {
  const name = stop.contactName.trim();
  const phone = displayPhone(stop.contactPhone);
  return (
    <View style={styles.stop}>
      <View style={styles.rail}>
        <View style={styles.pinCircle}>
          <LocationPin dropoff={last} />
        </View>
        {last ? null : <DottedConnector />}
      </View>
      <View style={styles.stopCopy}>
        <StopLabel>{label}</StopLabel>
        <Text style={styles.stopAddress}>{deliveryCardAddress(stop.address.trim())}</Text>
        {name ? (
          <View style={styles.meta}>
            <MaterialDesignIcons name="account-outline" size={16} color="#000000" />
            <Text style={styles.stopName}>{name}</Text>
          </View>
        ) : null}
        {phone ? (
          <View style={styles.meta}>
            <MaterialDesignIcons name="phone-outline" size={16} color="#000000" />
            {phone.startsWith('+263') && !last ? (
              <Image
                source={require('../../../../../assets/zimbabwe-flag.png')}
                style={styles.flag}
                resizeMode="cover"
              />
            ) : null}
            <Text style={styles.stopPhone}>{phone}</Text>
          </View>
        ) : null}
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
        const next = Math.max(1, Math.floor(event.nativeEvent.layout.height / 7));
        setCount((current) => (current === next ? current : next));
      }}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.dot} />
      ))}
    </View>
  );
}
function Fact({
  icon,
  mark,
  label,
  value,
}: {
  icon?: 'flash-outline' | 'message-text-outline' | 'account-group-outline' | 'cash' | 'cellphone';
  mark?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.fact}>
      {mark ?? (icon ? <MaterialDesignIcons name={icon} size={deliveryIcon.size} color={deliveryIcon.color} /> : null)}
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function describeParcel(draft: BookingDraft): string {
  const description = draft.description.trim();
  if (description === 'Parcel' || description === 'Document' || description === 'Food') {
    return description;
  }
  if (!draft.size) {
    return description;
  }
  return description ? `${description} · ${parcelSizeLabel(draft.size)}` : parcelSizeLabel(draft.size);
}

function displayPhone(value: string): string {
  const e164 = deliveryContactPhone(value);
  if (!e164) {
    return value.trim();
  }
  if (e164.startsWith('+263')) {
    return `+263 ${e164.slice(4)}`;
  }
  if (e164.startsWith('+31')) {
    return `+31 ${e164.slice(3)}`;
  }
  return e164;
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
  wrap: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  route: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    paddingLeft: spacing.xs,
    gap: spacing.sm,
  },
  stop: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  rail: {
    width: 32,
    alignItems: 'center',
  },
  pinCircle: {
    width: 32,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    position: 'absolute',
    top: 18,
    bottom: -spacing.sm,
    width: 32,
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#B7C2BC',
  },
  stopCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  stopAddress: {
    fontSize: typography.caption,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.text,
  },
  stopName: {
    flex: 1,
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  flag: {
    width: 22,
    height: 16,
    borderRadius: 2,
  },
  stopPhone: {
    flex: 1,
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  facts: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fact: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  factLabel: {
    fontSize: typography.small,
    color: colors.textSecondary,
  },
  factValue: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  priceCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  priceCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  distanceCopy: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  priceLabel: {
    fontSize: typography.small,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  price: {
    fontSize: typography.heading,
    fontWeight: '800',
    color: colors.text,
  },
  priceBlock: {
    gap: spacing.md,
  },
  offerLabel: {
    fontSize: typography.small,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  offerField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
  offerCurrency: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  offerInput: {
    flex: 1,
    fontSize: typography.button,
    fontWeight: '700',
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  distance: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
});
