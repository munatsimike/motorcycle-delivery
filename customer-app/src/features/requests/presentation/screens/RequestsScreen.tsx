import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import BottomSheetModal from '../../../../components/BottomSheetModal';
import SecondaryButton from '../../../../components/SecondaryButton';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import { deliveryTrackingTarget } from '../../../deliveries/domain/customerDeliveryList';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import DeliverySection from '../../../deliveries/presentation/components/DeliverySection';
import { savedDeliveryMessage } from '../../../deliveries/domain/recentDeliveryCache';
import { useCustomerDeliveries } from '../../../deliveries/presentation/viewmodels/useCustomerDeliveries';
import { deliveryContentKind, type DeliveryContentKind } from '../../../deliveries/domain/deliveryCard';
import { deliveriesInGroup, type DeliveryGroup } from '../../../deliveries/domain/deliveryStatus';
import { sortDeliveries, type DeliveryListSort } from '../../../deliveries/domain/deliveryListSort';

type DeliveriesNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Requests'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const GROUPS: { id: DeliveryGroup; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'history', label: 'History' },
];

const SORTS: { id: DeliveryListSort; label: string; hint: string; icon: 'clock-outline' | 'map-marker-distance' | 'currency-usd' }[] = [
  { id: 'newest', label: 'Newest', hint: 'Sort by newest date', icon: 'clock-outline' },
  { id: 'oldest', label: 'Oldest', hint: 'Sort by oldest date', icon: 'clock-outline' },
  { id: 'shortest', label: 'Shortest distance', hint: 'Sort by shortest distance', icon: 'map-marker-distance' },
  { id: 'longest', label: 'Longest distance', hint: 'Sort by longest distance', icon: 'map-marker-distance' },
  { id: 'highest', label: 'Highest price', hint: 'Sort by highest price', icon: 'currency-usd' },
  { id: 'lowest', label: 'Lowest price', hint: 'Sort by lowest price', icon: 'currency-usd' },
];

const CONTENT_FILTERS: { id: DeliveryContentKind | 'all'; label: string; icon: 'view-grid-outline' | 'package-variant-closed' | 'file-document-outline' | 'silverware-fork-knife' }[] = [
  { id: 'all', label: 'All', icon: 'view-grid-outline' },
  { id: 'parcel', label: 'Parcel', icon: 'package-variant-closed' },
  { id: 'document', label: 'Doc', icon: 'file-document-outline' },
  { id: 'food', label: 'Food', icon: 'silverware-fork-knife' },
];

export default function RequestsScreen() {
  const navigation = useNavigation<DeliveriesNavigation>();
  const { accessToken, customerId } = useSession();
  const { deliveries, isLoading, isLoadingMore, isRefreshing, error, hasMore, refresh, reload, loadMore, showingSaved, savedAt } = useCustomerDeliveries(accessToken, customerId);
  const offlineNote = showingSaved && savedAt ? savedDeliveryMessage(savedAt) : null;
  const [group, setGroup] = useState<DeliveryGroup>('active');
  const [contentKind, setContentKind] = useState<DeliveryContentKind | null>(null);
  const [sort, setSort] = useState<DeliveryListSort>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const grouped = deliveriesInGroup(deliveries, group);
  const visible = contentKind
    ? grouped.filter((delivery) => deliveryContentKind(delivery.parcelDescription) === contentKind)
    : grouped;
  const ordered = sortDeliveries(visible, sort);
  const emptyTitle = contentKind === 'food'
    ? 'No food deliveries'
    : contentKind === 'document'
      ? 'No documents'
      : contentKind === 'parcel'
        ? 'No parcels'
        : group === 'active'
          ? 'No active deliveries'
          : 'No past deliveries';
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.toolbar}>
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
        <View style={styles.filterRow}>
          <View style={styles.filters} accessibilityRole="radiogroup">
            {CONTENT_FILTERS.map((item) => {
              const selected = item.id === 'all' ? contentKind === null : item.id === contentKind;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    if (item.id === 'all' || selected) {
                      setContentKind(null);
                      return;
                    }
                    setContentKind(item.id);
                  }}
                  style={[styles.filter, selected && styles.filterSelected]}
                >
                  <MaterialDesignIcons
                    name={item.icon}
                    size={14}
                    color={selected ? colors.primaryDark : colors.textSecondary}
                  />
                  <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sort"
            onPress={() => setSortOpen(true)}
            style={styles.sortButton}
          >
            <MaterialDesignIcons name="swap-vertical" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <BottomSheetModal visible={sortOpen} onClose={() => setSortOpen(false)} closeLabel="Close sort">
          <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Sort by</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSortOpen(false)} hitSlop={8}>
                <MaterialDesignIcons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            <View accessibilityRole="radiogroup">
              {SORTS.map((item) => {
                const selected = item.id === sort;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="radio"
                    accessibilityLabel={item.hint}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSort(item.id);
                      setSortOpen(false);
                    }}
                    style={[styles.sortOption, selected && styles.sortOptionSelected]}
                  >
                    <MaterialDesignIcons
                      name={item.icon}
                      size={20}
                      color={selected ? colors.primaryDark : colors.textSecondary}
                    />
                    <Text style={[styles.sortOptionLabel, selected && styles.sortOptionLabelSelected]}>{item.label}</Text>
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected ? <MaterialDesignIcons name="check" size={14} color={colors.textInverse} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
      </BottomSheetModal>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        )}
      >
        <DeliverySection
          deliveries={ordered}
          isLoading={isLoading}
          error={error}
          refreshing={isRefreshing}
          emptyTitle={emptyTitle}
          emptyBody={contentKind && grouped.length > 0 ? 'None of these deliveries match this filter.' : 'All your deliveries will appear here once you book.'}
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
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <MaterialDesignIcons name="plus" color={colors.textInverse} size={22} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl + spacing.lg,
  },
  switcher: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filters: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sortButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  sheet: {
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  sortOptionSelected: {
    backgroundColor: colors.primaryLight,
  },
  sortOptionLabel: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: '500',
    color: colors.text,
  },
  sortOptionLabelSelected: {
    fontWeight: '700',
    color: colors.primaryDark,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderWidth: 0,
    backgroundColor: colors.primary,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterLabel: {
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterLabelSelected: {
    color: colors.primaryDark,
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
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    boxShadow: '0 2px 8px rgba(23, 33, 29, 0.14)',
  },
  fabPressed: {
    opacity: 0.85,
  },
});
