import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import { FadeSwapText } from '../../../../components/useMotion';
import ErrorMessage from '../../../../components/ErrorMessage';
import GreenSurface from '../../../../components/GreenSurface';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import BottomSheetModal from '../../../../components/BottomSheetModal';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { cancelCustomerDelivery } from '../../domain/usecases/cancelCustomerDelivery';
import { displayedCustomerOffer, type CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import ParcelDetailsSheet, { Summary } from '../components/ParcelDetailsSheet';
import { shortDeliveryReference } from '../../domain/deliveryCard';
import { deliveryCanDelete, deliveryCanSearchAgain, deliveryStatusLabel, usesDeliveryOutcomeScreen } from '../../domain/deliveryStatus';
import { bidCanAccept, committedDelivery, type BidAcceptance, type CustomerBid } from '../../domain/customerBids';
import { isMarketplaceDelivery } from '../../domain/marketplaceTracking';
import { riderAcceptedTrackingTarget } from '../../domain/customerDeliveryList';
import { riderSearchView } from '../../domain/riderSearchView';
import {
  arrivalTimeLabel,
  customerDistanceLabel,
  deliveryAwaitsRiderOffers,
  receivedOfferCountLabel,
  riderInitials,
  riderProfileFacts,
  tripCountLabel,
  showsRiderOffers,
  sortRiderOffers,
  type OfferSort,
} from '../../domain/riderOffers';
import AdjustPriceSheet from '../components/AdjustPriceSheet';
import DeliveryOutcome, { deliveryOutcomeTitle } from '../components/DeliveryOutcome';
import MarketplaceDelivery from '../components/MarketplaceDelivery';
import RiderPortrait from '../components/RiderPortrait';
import { bidProfilePhotoPath } from '../../domain/trackingJourney';
import { useDeliveryTracking } from '../viewmodels/useDeliveryTracking';
import { useIncomingOffers } from '../viewmodels/useIncomingOffers';

type DeliveryTrackingProps = NativeStackScreenProps<RootStackParamList, 'DeliveryTracking'>;

const TITLES = {
  loading: 'Track Delivery',
  searching: 'Delivery offers',
  assigned: 'Rider assigned',
  'no-rider': 'No rider found',
  offline: 'Track Delivery',
  details: 'Track Delivery',
} as const;

export default function DeliveryTrackingScreen({ route, navigation }: DeliveryTrackingProps) {
  const { accessToken } = useSession();
  const { delivery, isLoading, error, reload, cancelling, cancelError, cancelSearch } = useDeliveryTracking(accessToken, route.params.deliveryId);
  const deliveryRef = useRef(delivery);
  deliveryRef.current = delivery;
  const [confirmed, setConfirmed] = useState<{ delivery: CustomerDeliveryDetail; riderName: string } | null>(null);
  const onAccepted = useCallback((acceptance: BidAcceptance, bid: CustomerBid) => {
    const current = deliveryRef.current;
    if (!current || acceptance.deliveryId !== current.id) {
      reload();
      return;
    }
    setConfirmed({ delivery: committedDelivery(current, acceptance), riderName: bid.riderName });
    navigation.setParams(riderAcceptedTrackingTarget(current.id).params);
    reload();
  }, [navigation, reload]);
  const incoming = useIncomingOffers(accessToken, delivery, onAccepted);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [offerSort, setOfferSort] = useState<OfferSort>('price');
  const [profile, setProfile] = useState<CustomerBid | null>(null);
  const [searchingAgain, setSearchingAgain] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [savedOffer, setSavedOffer] = useState<{ id: string; amount: string } | null>(null);
  const shown = confirmed && delivery && confirmed.delivery.id === delivery.id && deliveryAwaitsRiderOffers(delivery)
    ? confirmed.delivery
    : delivery;
  const awaitingOffers = deliveryAwaitsRiderOffers(shown);
  const offers = sortRiderOffers(incoming.offers, offerSort);
  const offerSelectionBusy = incoming.chosen || incoming.acceptingId !== null;
  const view = riderSearchView({
    hasDelivery: Boolean(delivery),
    isLoading,
    status: delivery?.status ?? null,
    error,
  });
  useEffect(() => {
    setDetailsOpen(false);
    setOfferSort('price');
    setConfirmed(null);
    setProfile(null);
  }, [delivery?.id]);

  useLayoutEffect(() => {
    const headerRight = undefined;
    if (awaitingOffers) {
      navigation.setOptions({ title: TITLES.searching, headerRight });
      return;
    }
    if (view === 'searching') {
      navigation.setOptions({ title: 'Delivery', headerRight });
      return;
    }
    if (shown && usesDeliveryOutcomeScreen(shown.status)) {
      navigation.setOptions({ title: deliveryOutcomeTitle(shown.status), headerRight });
      return;
    }
    if (isMarketplaceDelivery(shown) && shown && !showsRiderOffers(shown) && !usesDeliveryOutcomeScreen(shown.status)) {
      const reference = shortDeliveryReference(shown.id);
      navigation.setOptions({
        title: 'Track delivery',
        headerRight: () => (
          <Text style={styles.reference}>Reference {reference}</Text>
        ),
      });
      return;
    }
    if (isMarketplaceDelivery(shown)) {
      navigation.setOptions({ title: 'Track delivery', headerRight });
      return;
    }
    navigation.setOptions({ title: TITLES[view], headerRight });
  }, [navigation, view, shown, awaitingOffers]);

  function confirmCancelSearch() {
    if (cancelling) {
      return;
    }
    Alert.alert(
      'Cancel this request?',
      'We will stop looking for a rider.',
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: () => {
            void stopSearch();
          },
        },
      ],
    );
  }

  async function stopSearch() {
    const cancelled = await cancelSearch();
    if (cancelled) {
      navigation.navigate('CustomerHome', { screen: 'Requests' });
    }
  }

  function confirmDelete() {
    if (!delivery || deleting) {
      return;
    }
    Alert.alert(
      'Delete this delivery?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteDelivery();
          },
        },
      ],
    );
  }

  async function deleteDelivery() {
    if (!delivery || deleting || !deliveryCanDelete(delivery)) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await cancelCustomerDelivery(customerDeliveryRepository, accessToken, delivery.id);
      navigation.navigate('CustomerHome', { screen: 'Requests' });
    } catch (caught: unknown) {
      setActionError(errorMessage(caught, 'This delivery could not be deleted.'));
      setDeleting(false);
    }
  }

  async function saveAdjustedOffer(deliveryId: string, offeredPrice: string) {
    if (!accessToken || savingOffer) {
      return;
    }
    setSavingOffer(true);
    setOfferError(null);
    try {
      const saved = await customerDeliveryRepository.adjustOffer(accessToken, deliveryId, offeredPrice);
      setSavedOffer({ id: deliveryId, amount: saved.customerOffer });
      setOfferOpen(false);
      reload();
    } catch (caught: unknown) {
      setOfferError(errorMessage(caught, 'This offer could not be saved.'));
    } finally {
      setSavingOffer(false);
    }
  }

  async function searchAgain() {
    if (!accessToken || !delivery || searchingAgain || !deliveryCanSearchAgain(delivery)) {
      return;
    }
    setSearchingAgain(true);
    setActionError(null);
    try {
      await customerDeliveryRepository.search(accessToken, delivery.id);
      reload();
    } catch (caught: unknown) {
      setActionError(errorMessage(caught, 'The search could not be started.'));
    } finally {
      setSearchingAgain(false);
    }
  }

  function confirmRider(bid: CustomerBid) {
    if (offerSelectionBusy || !bidCanAccept(bid)) {
      return;
    }
    Alert.alert(
      'Choose rider',
      `${bid.riderName}\n$${bid.amount}`,
      [
        { text: 'Keep comparing', style: 'cancel' },
        {
          text: 'Confirm rider',
          onPress: () => {
            void incoming.choose(bid);
          },
        },
      ],
    );
  }

  const outcomeDelivery = shown && usesDeliveryOutcomeScreen(shown.status) ? shown : null;
  if (outcomeDelivery) {
    const canSearch = deliveryCanSearchAgain(outcomeDelivery);
    const canDelete = deliveryCanDelete(outcomeDelivery);
    const showCustomerOffer = outcomeDelivery.status === 'NO_RIDER_FOUND';
    const offerAmount = savedOffer?.id === outcomeDelivery.id
      ? savedOffer.amount
      : displayedCustomerOffer(outcomeDelivery);
    return (
      <>
        <DeliveryOutcome
          delivery={outcomeDelivery}
          message={error ?? actionError ?? cancelError}
          customerOffer={showCustomerOffer}
          offerAmount={showCustomerOffer ? offerAmount : undefined}
          onAdjustPrice={showCustomerOffer && canSearch ? () => {
            setOfferError(null);
            setOfferOpen(true);
          } : undefined}
        >
          {canSearch || canDelete ? (
            <>
              {canSearch ? (
                <PrimaryButton
                  label="Search again"
                  icon="magnify"
                  loading={searchingAgain}
                  loadingLabel="Searching"
                  onPress={() => {
                    void searchAgain();
                  }}
                />
              ) : null}
              {canDelete ? (
                <SecondaryButton
                  label="Delete"
                  tone="danger"
                  bordered={false}
                  loading={deleting}
                  onPress={confirmDelete}
                />
              ) : null}
            </>
          ) : null}
        </DeliveryOutcome>
        {showCustomerOffer ? (
          <AdjustPriceSheet
            visible={offerOpen}
            amount={offerAmount}
            saving={savingOffer}
            error={offerError}
            onClose={() => {
              if (!savingOffer) {
                setOfferOpen(false);
              }
            }}
            onSave={(offeredPrice) => {
              void saveAdjustedOffer(outcomeDelivery.id, offeredPrice);
            }}
          />
        ) : null}
      </>
    );
  }

  if (isMarketplaceDelivery(shown) && shown && !showsRiderOffers(shown) && !usesDeliveryOutcomeScreen(shown.status)) {
    return (
      <MarketplaceDelivery
        delivery={shown}
        accessToken={accessToken}
        loadError={error}
        pendingRiderName={confirmed?.delivery.id === shown.id ? confirmed.riderName : null}
        showRiderConfirmation={route.params.riderConfirmed === true}
        onContinueConfirmation={() => navigation.setParams({ riderConfirmed: false })}
        onRefreshDelivery={reload}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={awaitingOffers ? (
          <RefreshControl
            refreshing={incoming.refreshing}
            onRefresh={() => {
              reload();
              void incoming.refresh();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        ) : undefined}
      >
        {awaitingOffers ? (
          <View style={styles.requestSent}>
            {offers.length === 0 ? (
              <>
                <View style={styles.requestIcon}>
                  <MaterialDesignIcons name="check" size={24} color={colors.primary} />
                </View>
                <Text style={styles.title}>Request sent!</Text>
                <Text style={styles.support}>
                  Your delivery request has been sent to nearby riders. You'll see their offers here as they respond.
                </Text>
                <View style={styles.waitingPill}>
                  <MaterialDesignIcons name="clock-outline" size={16} color={colors.primaryDark} />
                  <Text style={styles.waitingText}>Waiting for rider offers</Text>
                </View>
              </>
            ) : (
              <View style={styles.offersIntro}>
                <Text style={[styles.title, styles.alignLeft]}>{receivedOfferCountLabel(offers.length)}</Text>
                <Text style={[styles.support, styles.alignLeft]}>Compare offers and choose your preferred rider.</Text>
                <View style={styles.offerFilters}>
                  {(['price', 'distance'] as const).map((option) => {
                    const selected = offerSort === option;
                    const label = option === 'price' ? 'Price' : 'Distance';
                    const icon = option === 'price' ? 'currency-usd' : 'map-marker-distance';
                    const color = selected ? colors.primaryDark : colors.textSecondary;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Sort by ${label}`}
                        onPress={() => setOfferSort(option)}
                        style={[styles.offerFilter, selected && styles.offerFilterSelected]}
                      >
                        <MaterialDesignIcons name={icon} size={16} color={color} />
                        <Text style={[styles.offerFilterLabel, selected && styles.offerFilterLabelSelected]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Parcel details"
                  onPress={() => setDetailsOpen(true)}
                  style={styles.parcelDetails}
                >
                  <Text style={styles.parcelDetailsText}>Parcel details</Text>
                  <MaterialDesignIcons name="chevron-up" size={18} color={colors.primary} />
                </Pressable>
              </View>
            )}
            {incoming.unavailableNotice ? <Text style={styles.notice}>{incoming.unavailableNotice}</Text> : null}
            <ErrorMessage message={incoming.error ?? error ?? actionError ?? cancelError} />
          </View>
        ) : view === 'offline' ? (
          <ErrorMessage message={error ?? actionError ?? cancelError} />
        ) : (
          <GreenSurface style={styles.band}>
            <View style={styles.heroBody}>
              {view === 'loading' ? <LoadingIndicator /> : null}
              {view === 'assigned' ? <StatusIcon name="motorbike" /> : null}
              {view === 'details' && delivery ? <StatusIcon name="package-variant-closed" /> : null}
              {view !== 'loading' ? <FadeSwapText text={headline(view, delivery)} style={styles.title} /> : null}
              {view !== 'loading' ? <FadeSwapText text={support(view)} style={styles.support} /> : null}
              <ErrorMessage message={error ?? actionError ?? cancelError} />
            </View>
          </GreenSurface>
        )}
        {delivery && (!awaitingOffers || offers.length === 0) ? (
          <View style={[view === 'offline' ? styles.offlineSummary : styles.overlap, awaitingOffers ? styles.searchCard : null]}>
            <Summary delivery={delivery} />
          </View>
        ) : null}
        {awaitingOffers && offers.length === 0 ? (
          <View style={styles.cancelRequest}>
            <SecondaryButton
              label="Cancel request"
              tone="danger"
              bordered={false}
              loading={cancelling}
              onPress={confirmCancelSearch}
            />
          </View>
        ) : null}
        {offers.length > 0 ? (
          <View style={styles.offerList}>
            {offers.map((bid) => (
              <OfferCard
                key={bid.id}
                bid={bid}
                accessToken={accessToken}
                busy={offerSelectionBusy}
                loading={incoming.acceptingId === bid.id}
                onChoose={() => confirmRider(bid)}
                onProfile={() => setProfile(bid)}
              />
            ))}
          </View>
        ) : null}
        {awaitingOffers && offers.length === 0 && !incoming.loaded ? (
          <View style={styles.offerList}>
            <OfferSkeleton />
            <OfferSkeleton />
          </View>
        ) : null}
        {awaitingOffers && offers.length === 0 && incoming.loaded && incoming.error ? (
          <View style={styles.footer}>
            <SecondaryButton label="Retry" onPress={() => { void incoming.refresh(); }} />
          </View>
        ) : null}
        {awaitingOffers && offers.length === 0 && incoming.loaded && !incoming.error ? (
          <Text style={styles.leave}>
            You can leave this screen while we search. Check Deliveries for updates.
          </Text>
        ) : null}
      </ScrollView>
      <RiderProfileSheet
        bid={profile}
        accessToken={accessToken}
        busy={offerSelectionBusy}
        onClose={() => setProfile(null)}
        onChoose={(bid) => {
          setProfile(null);
          confirmRider(bid);
        }}
      />
      <ParcelDetailsSheet
        delivery={detailsOpen ? delivery : null}
        cancelling={cancelling}
        onClose={() => setDetailsOpen(false)}
        onCancel={confirmCancelSearch}
      />
    </SafeAreaView>
  );
}

function headline(
  view: ReturnType<typeof riderSearchView>,
  delivery: CustomerDeliveryDetail | null,
): string {
  if (view === 'assigned') {
    return 'Rider assigned';
  }
  if (view === 'offline') {
    return 'Connection problem';
  }
  return delivery ? deliveryStatusLabel(delivery.status) : 'Track Delivery';
}

function support(view: ReturnType<typeof riderSearchView>): string {
  if (view === 'assigned') {
    return 'A rider accepted this delivery.';
  }
  if (view === 'offline') {
    return 'The search status could not be refreshed.';
  }
  return 'This is the latest status from your delivery.';
}

function StatusIcon({ name }: { name: 'motorbike' | 'package-variant-closed' }) {
  return (
    <View style={styles.statusIcon}>
      <MaterialDesignIcons name={name} size={28} color={colors.primaryDark} />
    </View>
  );
}

function OfferCard({
  bid,
  accessToken,
  busy,
  loading,
  onChoose,
  onProfile,
}: {
  bid: CustomerBid;
  accessToken: string | null;
  busy: boolean;
  loading: boolean;
  onChoose: () => void;
  onProfile: () => void;
}) {
  const facts = riderProfileFacts(bid);
  return (
    <View style={[styles.card, styles.offerCard]}>
      <View style={styles.offerIdentity}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${bid.riderName} profile`} onPress={onProfile} disabled={busy}>
          <RiderPortrait
            name={bid.riderName}
            initials={riderInitials(bid.riderName)}
            path={bid.hasProfilePhoto ? bidProfilePhotoPath(bid.deliveryId, bid.id) : null}
            accessToken={accessToken}
            style={styles.offerAvatar}
            textStyle={styles.initials}
          />
        </Pressable>
        <View style={styles.offerBody}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${bid.riderName} profile`} onPress={onProfile} disabled={busy}>
            <View style={styles.offerTop}>
              <View style={styles.offerCopy}>
                <Text style={styles.offerName}>{bid.riderName}</Text>
                {facts.map((fact) => <Text key={fact} style={styles.offerMeta}>{fact}</Text>)}
              </View>
              <View style={styles.offerPriceBlock}>
                <Text style={styles.offerPriceLabel}>Offer</Text>
                <Text style={styles.offerPrice}>${bid.amount}</Text>
              </View>
            </View>
          </Pressable>
          {bidCanAccept(bid) ? (
            <View style={styles.offerBottom}>
              <PrimaryButton label="Choose rider" loading={loading} disabled={busy} onPress={onChoose} />
            </View>
          ) : (
            <Text style={styles.offerMeta}>This offer is no longer available.</Text>
          )}
        </View>
      </View>
    </View>
  );
}

function RiderProfileSheet({
  bid,
  accessToken,
  busy,
  onClose,
  onChoose,
}: {
  bid: CustomerBid | null;
  accessToken: string | null;
  busy: boolean;
  onClose: () => void;
  onChoose: (bid: CustomerBid) => void;
}) {
  const facts = bid ? riderProfileFacts(bid) : [];
  return (
    <BottomSheetModal visible={bid !== null} onClose={onClose} closeLabel="Close rider profile">
      {bid ? (
        <View style={styles.sheet}>
          <RiderPortrait
            name={bid.riderName}
            initials={riderInitials(bid.riderName)}
            path={bid.hasProfilePhoto ? bidProfilePhotoPath(bid.deliveryId, bid.id) : null}
            accessToken={accessToken}
            style={styles.avatar}
            textStyle={styles.initials}
          />
          <Text style={styles.sheetName}>{bid.riderName}</Text>
          {facts.map((fact) => <Text key={fact} style={styles.offerMeta}>{fact}</Text>)}
          <Text style={styles.offerPrice}>${bid.amount}</Text>
          {bidCanAccept(bid) ? (
            <PrimaryButton label="Choose rider" disabled={busy} onPress={() => onChoose(bid)} />
          ) : (
            <Text style={styles.notice}>This offer is no longer available.</Text>
          )}
          <SecondaryButton label="Close" bordered={false} onPress={onClose} />
        </View>
      ) : null}
    </BottomSheetModal>
  );
}

function OfferSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.offerIdentity}>
        <View style={styles.avatar} />
        <View style={styles.skeletonLines}>
          <View style={styles.skeletonLine} />
          <View style={styles.skeletonLineShort} />
        </View>
      </View>
      <View style={styles.skeletonPrice} />
    </View>
  );
}


const styles = StyleSheet.create({
  reference: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.lg,
  },
  band: {
    overflow: 'hidden',
    paddingBottom: spacing.xl,
  },
  heroBody: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  requestSent: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  cancelRequest: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
  },
  requestIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
  waitingText: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  notice: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  offerList: {
    gap: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  offersIntro: {
    alignSelf: 'stretch',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  offerFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  offerFilter: {
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
  offerFilterSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  offerFilterLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  offerFilterLabelSelected: {
    color: colors.primaryDark,
  },
  alignLeft: {
    alignSelf: 'stretch',
    textAlign: 'left',
  },
  parcelDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.xs,
  },
  parcelDetailsText: {
    fontSize: typography.button,
    fontWeight: '500',
    color: colors.primary,
  },
  offerIdentity: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  offerCard: {
    padding: 0,
    overflow: 'hidden',
  },
  offerBody: {
    flex: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingRight: spacing.lg,
    paddingBottom: spacing.lg,
    paddingLeft: spacing.sm,
  },
  offerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  offerBottom: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  offerCopy: {
    flex: 1,
    gap: 2,
  },
  offerAvatar: {
    width: 72,
    height: 72,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    marginLeft: spacing.sm,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  initials: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  offerName: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
    includeFontPadding: false,
  },
  offerMeta: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  offerPriceBlock: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 2,
  },
  offerPriceLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  offerPrice: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 0,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetName: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  skeletonLines: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonLine: {
    height: 14,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
  skeletonLineShort: {
    height: 12,
    width: '50%',
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
  skeletonPrice: {
    height: 22,
    width: 96,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    marginTop: spacing.sm,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  support: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  leave: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  overlap: {
    marginTop: -spacing.xxxl,
    marginHorizontal: spacing.lg,
  },
  offlineSummary: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
  },
  searchCard: {
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0 8px 24px rgba(23, 33, 29, 0.08)',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  footer: {
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
