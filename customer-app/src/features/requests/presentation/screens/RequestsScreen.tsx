import { useEffect, useState, useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { CompositeNavigationProp, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import type { Palette } from '../../../../theme';
import { radius, spacing, typography, useAppearance } from '../../../../theme';
import BottomSheetModal from '../../../../components/BottomSheetModal';
import SecondaryButton from '../../../../components/SecondaryButton';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import { deliveryTrackingTarget } from '../../../deliveries/domain/customerDeliveryList';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import DeliverySection from '../../../deliveries/presentation/components/DeliverySection';
import { savedDeliveryMessage } from '../../../deliveries/domain/recentDeliveryCache';
import { useCustomerDeliveries } from '../../../deliveries/presentation/viewmodels/useCustomerDeliveries';
import { deliveryContentKind, type DeliveryContentKind } from '../../../deliveries/domain/deliveryCard';
import { ACTIVE_LIST_STATUSES, HISTORY_LIST_STATUSES, type DeliveryGroup } from '../../../deliveries/domain/deliveryStatus';
import { sortDeliveries, type DeliveryListSort } from '../../../deliveries/domain/deliveryListSort';

type DeliveriesNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Requests'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const GROUPS: { id: DeliveryGroup; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'history', label: 'History' },
];

const SORTS: { id: DeliveryListSort; label: string; shortLabel: string; hint: string; icon: 'sort-ascending' | 'sort-descending' }[] = [
  { id: 'oldest', label: 'Date: oldest to newest', shortLabel: 'Date', hint: 'Sort by oldest date', icon: 'sort-ascending' },
  { id: 'newest', label: 'Date: newest to oldest', shortLabel: 'Date', hint: 'Sort by newest date', icon: 'sort-descending' },
  { id: 'shortest', label: 'Distance: shortest to longest', shortLabel: 'Distance', hint: 'Sort by shortest distance', icon: 'sort-ascending' },
  { id: 'longest', label: 'Distance: longest to shortest', shortLabel: 'Distance', hint: 'Sort by longest distance', icon: 'sort-descending' },
  { id: 'lowest', label: 'Price: lowest to highest', shortLabel: 'Price', hint: 'Sort by lowest price', icon: 'sort-ascending' },
  { id: 'highest', label: 'Price: highest to lowest', shortLabel: 'Price', hint: 'Sort by highest price', icon: 'sort-descending' },
];

const CONTENT_FILTERS: { id: DeliveryContentKind | 'all'; label: string; icon: 'view-grid-outline' | 'package-variant-closed' | 'file-document-outline' | 'silverware-fork-knife' }[] = [
  { id: 'all', label: 'All', icon: 'view-grid-outline' },
  { id: 'parcel', label: 'Parcel', icon: 'package-variant-closed' },
  { id: 'document', label: 'Doc', icon: 'file-document-outline' },
  { id: 'food', label: 'Food', icon: 'silverware-fork-knife' },
];

export default function RequestsScreen() {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<DeliveriesNavigation>();
  const route = useRoute<RouteProp<CustomerTabParamList, 'Requests'>>();
  const { accessToken, customerId } = useSession();
  const [group, setGroup] = useState<DeliveryGroup>(route.params?.group ?? 'active');
  useEffect(() => {
    const next = route.params?.group;
    if (next === 'active' || next === 'history') {
      setGroup(next);
    }
  }, [route.params?.group]);
  const activeList = useCustomerDeliveries(accessToken, customerId, ACTIVE_LIST_STATUSES);
  const historyList = useCustomerDeliveries(accessToken, customerId, HISTORY_LIST_STATUSES);
  const selectedList = group === 'active' ? activeList : historyList;
  const { deliveries, isLoading, isLoadingMore, isRefreshing, error, hasMore, refresh, reload, loadMore, showingSaved, savedAt } = selectedList;
  const offlineNote = showingSaved && savedAt ? savedDeliveryMessage(savedAt) : null;
  const [contentKind, setContentKind] = useState<DeliveryContentKind | null>(null);
  const [sort, setSort] = useState<DeliveryListSort>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const visible = contentKind
    ? deliveries.filter((delivery) => deliveryContentKind(delivery.parcelDescription) === contentKind)
    : deliveries;
  const ordered = sortDeliveries(visible, sort);
  const selectedSort = SORTS.find((item) => item.id === sort) ?? SORTS[1];
  const selectedFilter = CONTENT_FILTERS.find((item) => item.id === (contentKind ?? 'all')) ?? CONTENT_FILTERS[0];
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
    <View style={styles.screen}>
      <View style={[styles.stickyHeader, { paddingTop: insets.top + spacing.sm }]}>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Filter deliveries, ${selectedFilter.label}`}
            onPress={() => {
              setSortOpen(false);
              setFilterOpen(true);
            }}
            style={styles.sortButton}
          >
            <MaterialDesignIcons name="filter-variant" size={18} color={colors.text} />
            <Text style={styles.sortLabel}>{selectedFilter.label}</Text>
            <MaterialDesignIcons name="chevron-down" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sort deliveries, ${selectedSort.label}`}
            onPress={() => {
              setFilterOpen(false);
              setSortOpen(true);
            }}
            style={styles.sortButton}
          >
            <MaterialDesignIcons name="swap-vertical" size={18} color={colors.text} />
            <Text style={styles.sortLabel}>{selectedSort.shortLabel}</Text>
            <MaterialDesignIcons name="chevron-down" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>
      </View>
      <ScrollView
        style={styles.scroll}
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
        <View style={styles.sheet}>
      <BottomSheetModal visible={filterOpen} onClose={() => setFilterOpen(false)} closeLabel="Close filter">
        <View style={[styles.menu, { paddingBottom: spacing.lg + insets.bottom }]}>
          <Text style={styles.sheetTitle}>Filter</Text>
          <View accessibilityRole="radiogroup">
            {CONTENT_FILTERS.map((item) => {
              const selected = item.id === 'all' ? contentKind === null : item.id === contentKind;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setContentKind(item.id === 'all' || selected ? null : item.id);
                    setFilterOpen(false);
                  }}
                  style={[styles.sortOption, selected && styles.sortOptionSelected]}
                >
                  <MaterialDesignIcons
                    name={item.icon}
                    size={20}
                    color={selected ? colors.primaryDark : colors.textSecondary}
                  />
                  <Text style={[styles.sortOptionLabel, selected && styles.sortOptionLabelSelected]}>{item.label === 'Doc' ? 'Document' : item.label}</Text>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <MaterialDesignIcons name="check" size={14} color={colors.textInverse} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </BottomSheetModal>
      <BottomSheetModal visible={sortOpen} onClose={() => setSortOpen(false)} closeLabel="Close sort">
        <View style={[styles.menu, { paddingBottom: spacing.lg + insets.bottom }]}>
          <Text style={styles.sheetTitle}>Sort by</Text>
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
        <View style={styles.cardsInset}>
        <DeliverySection
          deliveries={ordered}
          isLoading={isLoading}
          error={error}
          refreshing={isRefreshing}
          emptyTitle={emptyTitle}
          emptyBody={contentKind && deliveries.length > 0 ? 'None of these deliveries match this filter.' : 'All your deliveries will appear here once you book.'}
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
        </View>
        {hasMore ? (
          <View style={styles.more}>
            <SecondaryButton label="Load more" onPress={loadMore} loading={isLoadingMore} disabled={isLoading} />
          </View>
        ) : null}
      </View>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send a parcel"
        onPress={() => navigation.navigate('ParcelRequest')}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <MaterialDesignIcons name="plus" color={colors.textInverse} size={22} />
      </Pressable>
    </View>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.listBackground,
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.listBackground,
  },
  content: {
    flexGrow: 1,
  },
  stickyHeader: {
    zIndex: 2,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.listBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(40,75,60,0.16)',
  },
  sheet: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl + spacing.lg,
  },
  cardsInset: {
    marginHorizontal: 6,
  },
  menu: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  toolbar: {
    paddingBottom: spacing.md,
    backgroundColor: 'transparent',
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  switcher: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.background === '#FFFFFF' ? '#E2EEE7' : colors.primaryLight,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: colors.background === '#FFFFFF' ? 0.08 : 0.32,
    shadowRadius: 8,
    elevation: 3,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  sortLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.text,
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
    paddingVertical: spacing.sm,
  },
  sortOptionSelected: {
    backgroundColor: colors.surface,
  },
  sortOptionLabel: {
    flex: 1,
    fontSize: typography.body,
    color: colors.text,
  },
  sortOptionLabelSelected: {
    fontWeight: '600',
    color: colors.primaryDark,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  switch: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  switchSelected: {
    backgroundColor: colors.background,
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
}
