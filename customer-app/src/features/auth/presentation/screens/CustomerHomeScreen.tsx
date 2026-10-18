import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CustomerAvatar from '../../../../components/CustomerAvatar';
import GreenSurface from '../../../../components/GreenSurface';
import PrimaryButton from '../../../../components/PrimaryButton';
import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { customerFirstName, customerGreeting } from '../../../account/domain/customerGreeting';
import { useCustomerAccount } from '../../../account/presentation/viewmodels/useCustomerAccount';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import DeliverySection from '../../../deliveries/presentation/components/DeliverySection';
import { deliveryTrackingTarget } from '../../../deliveries/domain/customerDeliveryList';
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
  const { deliveries, isLoading, error, reload } = useCustomerDeliveries(accessToken);
  const firstName = account ? customerFirstName(account) : null;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 360 ? spacing.lg : spacing.xl;
  const recentDeliveries = deliveries.slice(0, 2);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <GreenSurface
          style={[
            styles.intro,
            {
              marginHorizontal: -horizontalPadding,
              paddingHorizontal: horizontalPadding,
              paddingTop: insets.top + spacing.lg,
            },
          ]}
          fadeStyle={[styles.introFade, { marginHorizontal: -horizontalPadding }]}
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
            <View style={styles.deliveryIntro}>
              <Image
                source={require('../../../../../assets/rider-image.png')}
                style={styles.riderImage}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
              <View style={styles.deliveryCopy}>
                <View style={styles.deliveryText}>
                  <Text style={styles.deliveryTitle}>Motorbike delivery</Text>
                  <Text style={styles.deliveryMessage}>Get your parcels picked up and delivered by a motorbike.</Text>
                </View>
              </View>
            </View>
            <View style={styles.promises}>
              <View style={styles.promise}>
                <View style={[styles.promiseIcon, { backgroundColor: '#FFF1E0' }]}>
                  <MaterialDesignIcons name="flash" color="#E07A2F" size={16} />
                </View>
                <Text style={styles.promiseLabel}>Fast</Text>
              </View>
              <View style={styles.promise}>
                <View style={[styles.promiseIcon, { backgroundColor: '#E8F1FF' }]}>
                  <MaterialDesignIcons name="check" color="#3B6FE8" size={16} />
                </View>
                <Text style={styles.promiseLabel}>Reliable</Text>
              </View>
              <View style={styles.promise}>
                <View style={[styles.promiseIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialDesignIcons name="cash" color={colors.primary} size={16} />
                </View>
                <Text style={styles.promiseLabel}>Affordable</Text>
              </View>
            </View>
            <View style={styles.actionsDivider} />
            <View style={styles.sendWrap}>
              <PrimaryButton
                label="Send a Parcel"
                icon="package-variant"
                onPress={() => navigation.navigate('ParcelRequest')}
              />
            </View>
          </View>
        </GreenSurface>

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
          deliveries={recentDeliveries}
          isLoading={isLoading}
          error={error}
          emptyTitle="No deliveries"
          emptyBody="Recent deliveries will appear here when you book."
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
  intro: {
    boxShadow: '0 12px 24px rgba(23, 33, 29, 0.08)',
  },
  introFade: {
    height: 12,
    marginBottom: spacing.xs,
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
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  deliveryIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  riderImage: {
    width: 129,
    height: 97,
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
    lineHeight: 17,
    fontWeight: '800',
    color: colors.text,
    includeFontPadding: false,
  },
  deliveryMessage: {
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: spacing.xs,
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  promises: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  promise: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  promiseIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promiseLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
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
});
