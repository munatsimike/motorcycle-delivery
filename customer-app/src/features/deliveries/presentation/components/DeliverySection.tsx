import { StyleSheet, Text, View } from 'react-native';

import ErrorMessage from '../../../../components/ErrorMessage';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import SecondaryButton from '../../../../components/SecondaryButton';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { CustomerDelivery } from '../../domain/deliveryStatus';
import DeliveryCard from './DeliveryCard';

type DeliverySectionProps = {
  deliveries: CustomerDelivery[];
  isLoading: boolean;
  error: string | null;
  emptyTitle: string;
  emptyBody: string;
  onOpenDetails?: (deliveryId: string) => void;
  onRetry?: () => void;
  onSearchAgain?: (deliveryId: string) => Promise<void>;
};

export default function DeliverySection({
  deliveries,
  isLoading,
  error,
  emptyTitle,
  emptyBody,
  onOpenDetails,
  onRetry,
  onSearchAgain,
}: DeliverySectionProps) {
  if (isLoading && deliveries.length === 0) {
    return <LoadingIndicator />;
  }

  return (
    <View style={styles.list}>
      {error ? <ErrorMessage message={error} /> : null}
      {error && onRetry ? <SecondaryButton label="Try again" onPress={onRetry} /> : null}
      {!error && deliveries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptyBody}>{emptyBody}</Text>
        </View>
      ) : null}
      {deliveries.map((delivery) => (
        <DeliveryCard
          key={delivery.id}
          delivery={delivery}
          onOpenDetails={onOpenDetails}
          onSearchAgain={onSearchAgain}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  emptyTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    fontSize: typography.body,
    lineHeight: 24,
    color: colors.textSecondary,
  },
  list: {
    gap: spacing.md,
  },
});
