import { Image, StyleSheet, Text, View } from 'react-native';

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
          <Image
            source={require('../../../../../assets/parcel-box.png')}
            style={styles.emptyImage}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
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
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyImage: {
    width: 48,
    height: 48,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: typography.body,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  list: {
    gap: spacing.md,
  },
});
