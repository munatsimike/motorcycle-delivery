import { StyleSheet, Text, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import LoadingIndicator from '../../../../components/LoadingIndicator';
import { colors, radius, spacing, typography } from '../../../../theme';
import { deliveryContactPhone, type BookingDraft, type StopDraft } from '../../domain/bookingDraft';
import type { DeliveryQuote } from '../../domain/deliveryQuote';
import { parcelSizeLabel, payerLabel, paymentMethodLabel } from './ParcelFields';

type BookingSummaryProps = {
  draft: BookingDraft;
  quote: DeliveryQuote | null;
  quoting: boolean;
};

export default function BookingSummary({ draft, quote, quoting }: BookingSummaryProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.route}>
        <RouteStop label="Pickup" stop={draft.pickup} last={false} />
        <RouteStop label="Destination" stop={draft.dropoff} last />
      </View>

      <View style={styles.facts}>
        <Fact label="Sending" value={describeParcel(draft)} />
        <Fact label="Pays" value={draft.payer ? payerLabel(draft.payer) : ''} />
        <Fact label="Method" value={draft.paymentMethod ? paymentMethodLabel(draft.paymentMethod) : ''} />
      </View>

      <View style={styles.priceCard}>
        {quoting ? <LoadingIndicator /> : null}
        {quote && !quoting ? (
          <>
            <Text style={styles.priceLabel}>Price</Text>
            <Text style={styles.price}>{quote.currency} {quote.suggestedPrice}</Text>
            <Text style={styles.distance}>{formatDistance(quote.distanceMeters)}</Text>
          </>
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
        <MaterialDesignIcons
          name={last ? 'map-marker' : 'circle-slice-8'}
          size={18}
          color={last ? colors.primaryDark : colors.primary}
        />
        {last ? null : <View style={styles.line} />}
      </View>
      <View style={styles.stopCopy}>
        <Text style={styles.stopLabel}>{label}</Text>
        <Text style={styles.stopAddress}>{stop.address.trim()}</Text>
        {name ? <Text style={styles.stopName}>{name}</Text> : null}
        {phone ? <Text style={styles.stopPhone}>{phone}</Text> : null}
      </View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  stop: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rail: {
    width: 18,
    alignItems: 'center',
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 16,
    marginTop: spacing.xs,
    backgroundColor: colors.primary,
    opacity: 0.35,
  },
  stopCopy: {
    flex: 1,
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  stopLabel: {
    fontSize: typography.small,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stopAddress: {
    fontSize: typography.body,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.text,
  },
  stopName: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  stopPhone: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
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
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  priceLabel: {
    fontSize: typography.small,
    fontWeight: '700',
    color: colors.primaryDark,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  price: {
    fontSize: typography.title,
    fontWeight: '800',
    color: colors.text,
  },
  distance: {
    fontSize: typography.caption,
    color: colors.primaryDark,
  },
});
