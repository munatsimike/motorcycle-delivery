import { useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
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
  const scrollOffset = useRef(0);
  const scrollIntent = useRef(0);
  const fabCompact = useRef(false);
  const fabProgress = useRef(new Animated.Value(1)).current;
  const visible = deliveriesInGroup(deliveries, group);
  const labelSpace = fabProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 124],
  });
  const labelOpacity = fabProgress.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0, 0, 1],
  });

  function setFabCompact(compact: boolean) {
    if (fabCompact.current === compact) {
      return;
    }
    fabCompact.current = compact;
    Animated.timing(fabProgress, {
      toValue: compact ? 0 : 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = event.nativeEvent.contentOffset.y;
    const delta = y - scrollOffset.current;
    scrollOffset.current = y;
    if (y <= 8) {
      scrollIntent.current = 0;
      setFabCompact(false);
      return;
    }
    if (Math.abs(delta) < 1) {
      return;
    }
    if (scrollIntent.current !== 0 && Math.sign(delta) !== Math.sign(scrollIntent.current)) {
      scrollIntent.current = 0;
    }
    scrollIntent.current += delta;
    if (scrollIntent.current > 48) {
      scrollIntent.current = 0;
      setFabCompact(true);
    } else if (scrollIntent.current < -48) {
      scrollIntent.current = 0;
      setFabCompact(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
      >
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
          emptyBody="All your deliveries will appear here once you book."
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send a parcel"
        onPress={() => navigation.navigate('ParcelRequest')}
        style={({ pressed }) => [styles.fabHit, pressed && styles.fabPressed]}
      >
        <Animated.View style={styles.fab}>
          <MaterialDesignIcons name="plus" color={colors.textInverse} size={20} />
          <Animated.View style={[styles.fabLabelWrap, { width: labelSpace, opacity: labelOpacity }]}>
            <Text numberOfLines={1} style={styles.fabLabel}>Send a parcel</Text>
          </Animated.View>
        </Animated.View>
      </Pressable>
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
    paddingBottom: spacing.xxxl + spacing.xxl,
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
  fabHit: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.lg,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fab: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    shadowColor: '#169B62',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
    boxShadow: '0 4px 14px rgba(22, 155, 98, 0.35)',
  },
  fabLabelWrap: {
    overflow: 'hidden',
  },
  fabLabel: {
    marginLeft: spacing.xs,
    color: colors.textInverse,
    fontSize: typography.body,
    fontWeight: '700',
  },
});
