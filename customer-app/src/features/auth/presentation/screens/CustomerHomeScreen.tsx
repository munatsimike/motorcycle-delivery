import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CustomerAvatar from '../../../../components/CustomerAvatar';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { customerFirstName, customerGreeting } from '../../../account/domain/customerGreeting';
import { useCustomerAccount } from '../../../account/presentation/viewmodels/useCustomerAccount';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import DeliverySection from '../../../deliveries/presentation/components/DeliverySection';
import { deliveryTrackingTarget } from '../../../deliveries/domain/customerDeliveryList';
import { ACTIVE_LIST_STATUSES, deliveriesInGroup } from '../../../deliveries/domain/deliveryStatus';
import { useCustomerDeliveries } from '../../../deliveries/presentation/viewmodels/useCustomerDeliveries';
import { useSession } from '../viewmodels/useSession';

type HomeNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export default function CustomerHomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const { accessToken } = useSession();
  const { account } = useCustomerAccount(accessToken);
  const { deliveries, isLoading, isLoadingMore, error, hasMore, reload, loadMore } = useCustomerDeliveries(
    accessToken,
    ACTIVE_LIST_STATUSES,
  );
  const firstName = account ? customerFirstName(account) : null;
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 360 ? spacing.lg : spacing.xl;
  const activeDeliveries = deliveriesInGroup(deliveries, 'active');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <CustomerAvatar
            kind={account?.kind ?? 'INDIVIDUAL'}
            name={account?.name ?? null}
            customerId={account?.id}
            photoUrl={account?.photoUrl}
            size={48}
          />
          <View style={styles.greetingBlock}>
            <Text style={styles.greeting} accessibilityRole="text">{customerGreeting(new Date())}</Text>
            {firstName ? (
              <Text style={styles.name} accessibilityRole="header">{firstName}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroTitle} accessibilityRole="header">Need to send a parcel?</Text>
          <Text style={styles.heroBody}>
            Fast, reliable motorcycle deliveries across the city.
          </Text>
          <PrimaryButton
            label="Send a Parcel"
            icon="package-variant"
            onPress={() => navigation.navigate('ParcelRequest')}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent deliveries</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Requests')}
            style={styles.viewAll}
          >
            <Text style={styles.viewAllText}>View all</Text>
            <MaterialDesignIcons name="chevron-right" color={colors.primary} size={18} />
          </Pressable>
        </View>
        <DeliverySection
          deliveries={activeDeliveries}
          isLoading={isLoading}
          error={error}
          emptyTitle="No active deliveries"
          emptyBody="Your current delivery will appear here once you book."
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xxxl,
  },
  greetingBlock: {
    flex: 1,
    flexShrink: 1,
    gap: spacing.xs,
  },
  greeting: {
    fontSize: typography.caption,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  name: {
    fontSize: typography.heading,
    fontWeight: '600',
    color: colors.text,
  },
  hero: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    color: colors.text,
  },
  heroBody: {
    fontSize: typography.body,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 2,
  },
  viewAllText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.primary,
  },
  more: {
    marginTop: spacing.md,
  },
});
