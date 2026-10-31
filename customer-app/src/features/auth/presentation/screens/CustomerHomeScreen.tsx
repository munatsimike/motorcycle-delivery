import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CustomerAvatar from '../../../../components/CustomerAvatar';
import GreenSurface from '../../../../components/GreenSurface';
import PrimaryButton from '../../../../components/PrimaryButton';
import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { customerFirstName, customerGreeting } from '../../../account/domain/customerGreeting';
import { useCustomerAccount } from '../../../account/presentation/viewmodels/useCustomerAccount';
import { useCustomerProfilePhoto } from '../../../account/presentation/viewmodels/useCustomerProfilePhoto';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import DeliverySection from '../../../deliveries/presentation/components/DeliverySection';
import { deliveryTrackingTarget } from '../../../deliveries/domain/customerDeliveryList';
import { savedDeliveryMessage } from '../../../deliveries/domain/recentDeliveryCache';
import { useCustomerDeliveries } from '../../../deliveries/presentation/viewmodels/useCustomerDeliveries';
import { nearbyHomeCountLabel } from '../../../riders/domain/nearbyCard';
import { useNearbyRiders } from '../../../riders/presentation/viewmodels/useNearbyRiders';
import { useSession } from '../viewmodels/useSession';

type HomeNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export default function CustomerHomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const { accessToken, customerId } = useSession();
  const { account } = useCustomerAccount(accessToken);
  const photo = useCustomerProfilePhoto(accessToken, account);
  const { deliveries, isLoading, isRefreshing, error, refresh, reload, showingSaved, savedAt } = useCustomerDeliveries(accessToken, customerId);
  const nearby = useNearbyRiders(accessToken);
  const offlineNote = showingSaved && savedAt ? savedDeliveryMessage(savedAt) : null;
  const firstName = account ? customerFirstName(account) : null;
  const insets = useSafeAreaInsets();
  const horizontalPadding = spacing.lg;
  const recentDeliveries = deliveries.slice(0, 2);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void refresh();
              void nearby.tryAgain();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        )}
      >
        <GreenSurface
          style={{
            marginHorizontal: -horizontalPadding,
            paddingHorizontal: horizontalPadding,
            paddingTop: insets.top + spacing.lg,
          }}
          fadeStyle={[styles.introFade, { marginHorizontal: -horizontalPadding }]}
        >
          <View style={styles.topRow}>
            <CustomerAvatar
              kind={account?.kind ?? 'INDIVIDUAL'}
              name={account?.name ?? null}
              customerId={account?.id}
              photoUrl={photo.uri}
              size={48}
            />
            <View style={styles.greetingBlock}>
              <Text style={styles.greeting} accessibilityRole="text">{customerGreeting(new Date())}</Text>
              {firstName ? (
                <Text style={styles.name} accessibilityRole="header">{firstName}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              hitSlop={8}
              onPress={() => navigation.navigate('Requests')}
              style={styles.notificationButton}
            >
              <MaterialDesignIcons name="bell-outline" color={colors.text} size={22} />
            </Pressable>
          </View>

          <View style={styles.actionsCard}>
            <View style={styles.deliveryIntro}>
              <View style={styles.riderFrame}>
                <Image
                  source={require('../../../../../assets/rider-image.png')}
                  style={styles.riderImage}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
              </View>
              <View style={styles.deliveryCopy}>
                <View style={styles.deliveryText}>
                  <Text style={styles.deliveryTitle}>Nearby riders</Text>
                  {nearby.state.status === 'loading' ? (
                    <View style={styles.checkingRow}>
                      <ActivityIndicator size="small" color={colors.textSecondary} />
                      <Text style={styles.checkingText}>{nearbyHomeCountLabel(nearby.state)}</Text>
                    </View>
                  ) : (
                    <Text
                      style={styles.deliveryMessage}
                      onPress={nearby.state.status === 'ready' ? undefined : () => {
                        if (nearby.state.status === 'services-off') {
                          void nearby.turnOnLocation();
                          return;
                        }
                        if (nearby.state.status === 'permission-denied') {
                          void nearby.allowLocation();
                          return;
                        }
                        void nearby.tryAgain();
                      }}
                    >
                      {nearbyHomeCountLabel(nearby.state)}
                    </Text>
                  )}
                </View>
              </View>
            </View>
            <View style={styles.actionsDivider} />
            <View style={styles.sendWrap}>
              <PrimaryButton
                label="Send a Parcel"
                icon="package-variant-closed"
                onPress={() => navigation.navigate('ParcelRequest')}
              />
            </View>
          </View>
        </GreenSurface>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent deliveries</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => navigation.navigate('Requests')}
            style={styles.viewAll}
          >
            <Text style={styles.viewAllText}>View all</Text>
            <MaterialDesignIcons name="chevron-right" color={colors.primary} size={18} />
          </Pressable>
        </View>
        <DeliverySection
          deliveries={recentDeliveries}
          isLoading={isLoading}
          error={error}
          compact
          refreshing={isRefreshing}
          emptyTitle="No deliveries"
          emptyBody="Recent deliveries will appear here when you book."
          offlineNote={offlineNote}
          cached={showingSaved}
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
  introFade: {
    height: spacing.lg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  greetingBlock: {
    flex: 1,
    flexShrink: 1,
    gap: spacing.xs,
  },
  notificationButton: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
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
  actionsCard: {
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0 8px 24px rgba(23, 33, 29, 0.08)',
    overflow: 'hidden',
  },
  deliveryIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  riderFrame: {
    width: 112,
    height: 86,
    overflow: 'hidden',
  },
  riderImage: {
    width: 132,
    height: 99,
    marginLeft: -10,
    marginTop: -2,
  },
  deliveryCopy: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  deliveryText: {
    flexGrow: 0,
    flexShrink: 1,
  },
  deliveryTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.text,
    includeFontPadding: false,
  },
  deliveryMessage: {
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: spacing.sm,
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  checkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  checkingText: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textSecondary,
    includeFontPadding: false,
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
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.heading,
    lineHeight: 24,
    fontWeight: '700',
    color: colors.text,
    includeFontPadding: false,
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.primary,
  },
});
