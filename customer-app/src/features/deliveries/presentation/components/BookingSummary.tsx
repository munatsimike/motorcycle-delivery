import { StyleSheet, Text, View } from 'react-native';

import LoadingIndicator from '../../../../components/LoadingIndicator';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { BookingDraft } from '../../domain/bookingDraft';
import type { DeliveryQuote } from '../../domain/deliveryQuote';
import { parcelSizeLabel, payerLabel, paymentMethodLabel } from './ParcelFields';

type BookingSummaryProps = {
  draft: BookingDraft;
  quote: DeliveryQuote | null;
  quoting: boolean;
};

export default function BookingSummary({ draft, quote, quoting }: BookingSummaryProps) {
  return (
    <View style={styles.card}>
      <SummaryRow label="Pickup" value={draft.pickup.address.trim()} />
      <SummaryRow label="Destination" value={draft.dropoff.address.trim()} />
      <SummaryRow label="Parcel" value={describeParcel(draft)} />
      <SummaryRow label="Payment" value={describePayment(draft)} />
      {quoting ? <LoadingIndicator /> : null}
      {quote && !quoting ? (
        <>
          <SummaryRow label="Distance" value={`${quote.distanceMeters} m`} />
          <SummaryRow label="Price" value={`${quote.currency} ${quote.suggestedPrice}`} />
        </>
      ) : null}
    </View>
  );
}

function describeParcel(draft: BookingDraft): string {
  const description = draft.description.trim();
  if (!draft.size) {
    return description;
  }
  return description ? `${description} · ${parcelSizeLabel(draft.size)}` : parcelSizeLabel(draft.size);
}

function describePayment(draft: BookingDraft): string {
  if (!draft.payer || !draft.paymentMethod) {
    return '';
  }
  return `${payerLabel(draft.payer)} · ${paymentMethodLabel(draft.paymentMethod)}`;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  row: {
    gap: spacing.xs,
  },
  label: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  value: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.text,
    flexShrink: 1,
  },
});
