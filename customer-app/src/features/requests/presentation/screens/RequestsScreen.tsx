import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import SecondaryButton from '../../../../components/SecondaryButton';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import { deliveryTrackingTarget } from '../../../deliveries/domain/customerDeliveryList';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import DeliverySection from '../../../deliveries/presentation/components/DeliverySection';
import { useCustomerDeliveries } from '../../../deliveries/presentation/viewmodels/useCustomerDeliveries';
import { deliveriesInGroup, type DeliveryGroup } from '../../../deliveries/domain/deliveryStatus';

type DeliveriesNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Requests'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const GROUPS: { id: DeliveryGroup; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'history', label: 'History' },
];

export default function RequestsScreen() {
  const navigation = useNavigation<DeliveriesNavigation>();
  const { accessToken } = useSession();
  const { deliveries, isLoading, isLoadingMore, error, hasMore, reload, loadMore } = useCustomerDeliveries(accessToken);
  const [group, setGroup] = useState<DeliveryGroup>('active');
  const visible = deliveriesInGroup(deliveries, group);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Deliveries</Text>
        <View style={styles.switcher}>
          {GROUPS.map((item) => {
            const selected = item.id === group;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setGroup(item.id)}
                style={[styles.switch, selected && styles.switchSelected]}
              >
                <Text style={[styles.switchLabel, selected && styles.switchLabelSelected]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <DeliverySection
          deliveries={visible}
          isLoading={isLoading}
          error={error}
          emptyTitle={group === 'active' ? 'No active deliveries' : 'No past deliveries'}
          emptyBody={
            group === 'active'
              ? 'Your current delivery will appear here once you book.'
              : 'Completed, cancelled, and failed deliveries will appear here.'
          }
          onOpenDetails={(deliveryId) => {
            const target = deliveryTrackingTarget(deliveryId);
            navigation.navigate(target.screen, target.params);
          }}
          onSearchAgain={async (deliveryId) => {
            if (!accessToken) {
              return;
            }
            await customerDeliveryRepository.search(accessToken, deliveryId);
            reload();
          }}
          onRetry={reload}
        />
        {hasMore ? (
          <View style={styles.more}>
            <SecondaryButton label="Load more" onPress={loadMore} loading={isLoadingMore} disabled={isLoading} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
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
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  switcher: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  switch: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  switchSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  switchLabel: {
    fontSize: typography.body,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  switchLabelSelected: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  more: {
    marginTop: spacing.md,
  },
});
