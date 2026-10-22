import { Image, StyleSheet, Text, View } from 'react-native';

import ErrorMessage from '../../../../components/ErrorMessage';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { CustomerDelivery } from '../../domain/deliveryStatus';
import DeliveryCard from './DeliveryCard';
import OfflineDeliveriesNotice from './OfflineDeliveriesNotice';

type DeliverySectionProps = {
  deliveries: CustomerDelivery[];
  isLoading: boolean;
  error: string | null;
  emptyTitle: string;
  emptyBody: string;
  compact?: boolean;
  refreshing?: boolean;
  offlineNote?: string | null;
  cached?: boolean;
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
  compact = false,
  refreshing = false,
  offlineNote = null,
  cached = false,
  onOpenDetails,
  onRetry,
  onSearchAgain,
}: DeliverySectionProps) {
  if (isLoading && !refreshing && deliveries.length === 0) {
    return <LoadingIndicator />;
  }

  return (
    <View style={styles.list}>
      {offlineNote ? <OfflineDeliveriesNotice message={offlineNote} onRetry={onRetry} /> : null}
      {error ? <ErrorMessage message={error} /> : null}
      {!error && deliveries.length === 0 ? (
        <View style={[styles.empty, compact && styles.emptyCompact]}>
          <Image
            source={require('../../../../../assets/parcel-box.png')}
            style={[styles.emptyImage, compact && styles.emptyImageCompact]}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <Text style={[styles.emptyTitle, compact && styles.emptyTitleCompact]}>{emptyTitle}</Text>
          <Text style={styles.emptyBody}>{emptyBody}</Text>
        </View>
      ) : null}
      {deliveries.map((delivery) => (
        <DeliveryCard
          key={delivery.id}
          delivery={delivery}
          cached={cached}
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
  emptyCompact: {
    paddingVertical: spacing.xs,
    paddingHorizontal: 0,
  },
  emptyImage: {
    width: 40,
    height: 40,
    marginBottom: spacing.sm,
  },
  emptyImageCompact: {
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyTitleCompact: {
    marginBottom: spacing.xs,
    lineHeight: 24,
    includeFontPadding: false,
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
