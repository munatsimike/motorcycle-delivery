import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import NearbyRidersCard from '../../../riders/presentation/components/NearbyRidersCard';
import { useNearbyRiders } from '../../../riders/presentation/viewmodels/useNearbyRiders';

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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 360 ? spacing.lg : spacing.xl;
  const activeDeliveries = deliveriesInGroup(deliveries, 'active');
  const nearby = useNearbyRiders(accessToken);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.intro,
            {
              marginHorizontal: -horizontalPadding,
              paddingHorizontal: horizontalPadding,
              paddingTop: insets.top + spacing.lg,
            },
          ]}
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
            <View accessibilityLabel="Notifications" style={styles.bell}>
              <MaterialDesignIcons name="bell-outline" color={colors.text} size={24} />
            </View>
          </View>

          <View style={styles.actionsCard}>
            <NearbyRidersCard
              embedded
              state={nearby.state}
              onTurnOnLocation={() => {
                void nearby.turnOnLocation();
              }}
              onAllowLocation={() => {
                void nearby.allowLocation();
              }}
              onTryAgain={() => {
                void nearby.tryAgain();
              }}
            />
            <View style={styles.actionsDivider} />
            <View style={styles.sendWrap}>
              <PrimaryButton
                label="Send a Parcel"
                icon="package-variant"
                onPress={() => navigation.navigate('ParcelRequest')}
              />
            </View>
          </View>
        </View>
        <LinearGradient
          colors={[colors.primaryLight, colors.background]}
          style={[styles.introFade, { marginHorizontal: -horizontalPadding }]}
          pointerEvents="none"
        />

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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  intro: {
    backgroundColor: colors.primaryLight,
    boxShadow: '0 12px 24px rgba(23, 33, 29, 0.08)',
  },
  introFade: {
    height: 36,
    marginBottom: spacing.lg,
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
  bell: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsCard: {
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0 8px 24px rgba(23, 33, 29, 0.08)',
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  sendWrap: {
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  actionsDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.border,
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
