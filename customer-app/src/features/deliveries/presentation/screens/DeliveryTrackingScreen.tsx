import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import SecondaryButton from '../../../../components/SecondaryButton';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { deliveryStatusLabel, type DeliveryStatus } from '../../domain/deliveryStatus';
import RiderSearchMap from '../components/RiderSearchMap';
import { useDeliveryTracking } from '../viewmodels/useDeliveryTracking';

type DeliveryTrackingProps = NativeStackScreenProps<RootStackParamList, 'DeliveryTracking'>;

export default function DeliveryTrackingScreen({ route }: DeliveryTrackingProps) {
  const { accessToken } = useSession();
  const { delivery, isLoading, error, reload } = useDeliveryTracking(accessToken, route.params.deliveryId);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? <LoadingIndicator /> : null}
        <ErrorMessage message={error} />
        {delivery && findingRider(delivery.status) ? (
          <RiderSearchMap latitude={delivery.pickupLatitude} longitude={delivery.pickupLongitude} />
        ) : null}
        {delivery ? (
          <View style={styles.card}>
            <Text style={styles.status}>{deliveryStatusLabel(delivery.status)}</Text>
            {delivery.status === 'CREATED' ? (
              <Text style={styles.note}>This delivery is booked. A rider has not accepted it yet.</Text>
            ) : null}
            {delivery.status === 'NO_RIDER_FOUND' ? (
              <Text style={styles.note}>No rider was available for this delivery.</Text>
            ) : null}
            <Detail label="Pickup" value={delivery.pickupAddress} />
            <Detail label="Drop-off" value={delivery.dropoffAddress} />
            <Detail label="Parcel" value={delivery.parcelDescription} />
            <Detail label="Price" value={`${delivery.currency} ${delivery.offeredPrice}`} />
            {delivery.suggestedPrice !== delivery.offeredPrice ? (
              <Detail label="Quoted price" value={`${delivery.currency} ${delivery.suggestedPrice}`} />
            ) : null}
          </View>
        ) : null}
        {!isLoading && error && !delivery ? <SecondaryButton label="Try again" onPress={reload} /> : null}
        {delivery ? <SecondaryButton label="Refresh" onPress={reload} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function findingRider(status: DeliveryStatus): boolean {
  return status === 'CREATED' || status === 'SEARCHING';
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  status: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  note: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  detail: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  label: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  value: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.text,
  },
});
