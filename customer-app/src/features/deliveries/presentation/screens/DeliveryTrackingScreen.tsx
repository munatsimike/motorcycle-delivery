import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import { FadeSwapText } from '../../../../components/useMotion';
import ErrorMessage from '../../../../components/ErrorMessage';
import GreenSurface from '../../../../components/GreenSurface';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import BottomSheetModal from '../../../../components/BottomSheetModal';
import DialogModal, { DialogActions, DialogBody, DialogTextButton, DialogTitle } from '../../../../components/DialogModal';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import type { RootStackParamList } from '../../../../navigation/types';
import { bottomContentInset, colors, radius, spacing, typography } from '../../../../theme';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { cancelCustomerDelivery } from '../../domain/usecases/cancelCustomerDelivery';
import { displayedCustomerOffer, type CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import ParcelDetailsSheet, { Summary } from '../components/ParcelDetailsSheet';
import { deliveryCanDelete, deliveryCanSearchAgain, deliveryStatusLabel, usesDeliveryOutcomeScreen } from '../../domain/deliveryStatus';
import {
  bidCanAccept,
  confirmationRiderName,
  confirmRiderSheetState,
  committedDelivery,
  type BidAcceptance,
  type CustomerBid,
} from '../../domain/customerBids';
import { showsLiveTrackingMap } from '../../domain/marketplaceTracking';
import { riderAcceptedTrackingTarget } from '../../domain/customerDeliveryList';
import { riderSearchView } from '../../domain/riderSearchView';
import {
  deliveryAwaitsRiderOffers,
  newOfferReceived,
  pickupEtaLabel,
  receivedOfferCountLabel,
  riderInitials,
  showsRiderOffers,
  sortRiderOffers,
  type OfferSort,
} from '../../domain/riderOffers';
import { riderClassColors, riderClassLabel, riderRatingLine } from '../../domain/riderClass';
import { ratingPromptVisible } from '../../domain/riderRating';
import AdjustPriceSheet from '../components/AdjustPriceSheet';
import DeliveryDetailFrame from '../components/DeliveryDetailFrame';
import RidersMap from '../../../../components/maps/RidersMap';
import DeliveryOutcome from '../components/DeliveryOutcome';
import MarketplaceDelivery from '../components/MarketplaceDelivery';
import RiderPortrait from '../components/RiderPortrait';
import { bidProfilePhotoPath } from '../../domain/trackingJourney';
import { useNearbyRiders } from '../../../riders/presentation/viewmodels/useNearbyRiders';
import { useDeliveryTracking } from '../viewmodels/useDeliveryTracking';
import { useIncomingOffers } from '../viewmodels/useIncomingOffers';

type DeliveryTrackingProps = NativeStackScreenProps<RootStackParamList, 'DeliveryTracking'>;

const OFFER_SORTS: { id: OfferSort; label: string; shortLabel: string; icon: 'sort-ascending' | 'sort-descending' }[] = [
  { id: 'price', label: 'Price: lowest to highest', shortLabel: 'Price', icon: 'sort-ascending' },
  { id: 'price-high', label: 'Price: highest to lowest', shortLabel: 'Price', icon: 'sort-descending' },
  { id: 'rides-low', label: 'Rides: lowest to highest', shortLabel: 'Rides', icon: 'sort-ascending' },
  { id: 'rides-high', label: 'Rides: highest to lowest', shortLabel: 'Rides', icon: 'sort-descending' },
];

export default function DeliveryTrackingScreen({ route, navigation }: DeliveryTrackingProps) {
  const { accessToken } = useSession();
  const insets = useSafeAreaInsets();
  const nearby = useNearbyRiders(accessToken);
  const [offersSheetHeight, setOffersSheetHeight] = useState(0);
  const { delivery, isLoading, isRefreshing, error, reload, cancelling, cancelError, cancelSearch } = useDeliveryTracking(accessToken, route.params.deliveryId);
  const deliveryRef = useRef(delivery);
  deliveryRef.current = delivery;
  const [confirmed, setConfirmed] = useState<{ delivery: CustomerDeliveryDetail; riderName: string } | null>(null);
  const onAccepted = useCallback((acceptance: BidAcceptance, bid: CustomerBid) => {
    const current = deliveryRef.current;
    if (!current || acceptance.deliveryId !== current.id) {
      reload();
      return;
    }
    setConfirmed({
      delivery: committedDelivery(current, acceptance),
      riderName: confirmationRiderName(acceptance, bid.riderName),
    });
    navigation.setParams(riderAcceptedTrackingTarget(current.id).params);
    reload();
  }, [navigation, reload]);
  const incoming = useIncomingOffers(accessToken, delivery, onAccepted);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [offerSort, setOfferSort] = useState<OfferSort>('price');
  const [sortOpen, setSortOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<CustomerBid | null>(null);
  const [searchingAgain, setSearchingAgain] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [savedOffer, setSavedOffer] = useState<{ id: string; amount: string } | null>(null);
  const [prompt, setPrompt] = useState<null | 'cancel' | 'delete'>(null);
  const [ratingSkipped, setRatingSkipped] = useState(false);
  const [ratingStars, setRatingStars] = useState<number | null>(null);
  const [savingRating, setSavingRating] = useState(false);
  const shown = confirmed && delivery && confirmed.delivery.id === delivery.id && deliveryAwaitsRiderOffers(delivery)
    ? confirmed.delivery
    : delivery;
  const awaitingOffers = deliveryAwaitsRiderOffers(shown);
  const offers = sortRiderOffers(incoming.offers, offerSort);
  const offerKey = offers.map((bid) => bid.id).join('\n');
  const seenOffers = useRef<{ deliveryId: string | null; ids: string[] }>({ deliveryId: null, ids: [] });
  const selectedOfferSort = OFFER_SORTS.find((item) => item.id === offerSort) ?? OFFER_SORTS[0];
  const offerSelectionBusy = incoming.chosen || incoming.acceptingId !== null;
  const view = riderSearchView({
    hasDelivery: Boolean(delivery),
    isLoading,
    status: delivery?.status ?? null,
    error,
  });
  useEffect(() => {
    setRatingSkipped(false);
    setRatingStars(null);
    setSavingRating(false);
    setDetailsOpen(false);
    setOfferSort('price');
    setSortOpen(false);
    setConfirmed(null);
    setPendingConfirm(null);
  }, [delivery?.id]);

  useEffect(() => {
    if (incoming.chosen) {
      setPendingConfirm(null);
      setDetailsOpen(false);
      setSortOpen(false);
    }
  }, [incoming.chosen]);

  useEffect(() => {
    const nextIds = offerKey ? offerKey.split('\n') : [];
    const sameRequest = seenOffers.current.deliveryId === (delivery?.id ?? null);
    const arrived = sameRequest && newOfferReceived(seenOffers.current.ids, nextIds);
    seenOffers.current = { deliveryId: delivery?.id ?? null, ids: nextIds };
    if (arrived) {
      setDetailsOpen(false);
      setSortOpen(false);
    }
  }, [delivery?.id, offerKey]);

  function confirmCancelSearch() {
    if (cancelling) {
      return;
    }
    setDetailsOpen(false);
    setPrompt('cancel');
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
    setPrompt('delete');
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
    if (!bidCanAccept(bid)) {
      return;
    }
    if (offerSelectionBusy) {
      return;
    }
    setPendingConfirm(bid);
  }

  const liveMap = showsLiveTrackingMap(shown) && shown !== null && !showsRiderOffers(shown);
  const outcomeDelivery = shown && usesDeliveryOutcomeScreen(shown.status) && !liveMap ? shown : null;
  if (outcomeDelivery) {
    const canSearch = deliveryCanSearchAgain(outcomeDelivery);
    const canDelete = deliveryCanDelete(outcomeDelivery);
    const showCustomerOffer = outcomeDelivery.status === 'NO_RIDER_FOUND';
    const offerAmount = savedOffer?.id === outcomeDelivery.id
      ? savedOffer.amount
      : displayedCustomerOffer(outcomeDelivery);
    const rating = outcomeDelivery.rating;
    const submittedStars = rating.submitted ? rating.stars : ratingStars;
    const showRatingSheet = ratingPromptVisible(rating, ratingSkipped) && submittedStars == null;
    return (
      <>
        <DeliveryOutcome
          delivery={outcomeDelivery}
          onBack={() => navigation.goBack()}
          accessToken={accessToken}
          message={error ?? actionError ?? cancelError}
          customerOffer={showCustomerOffer}
          offerAmount={showCustomerOffer ? offerAmount : undefined}
          onAdjustPrice={showCustomerOffer && canSearch ? () => {
            setOfferError(null);
            setOfferOpen(true);
          } : undefined}
        >
          {submittedStars ? (
            <View style={styles.ratedNoteRow}>
              <MaterialDesignIcons name="star" size={19} color="#E8A317" />
              <Text style={styles.ratedNote}>You rated this rider {submittedStars} of 5.</Text>
            </View>
          ) : null}
          {rating.eligible && !submittedStars && ratingSkipped ? (
            <SecondaryButton
              label="Rate rider"
              bordered={false}
              onPress={() => setRatingSkipped(false)}
            />
          ) : null}
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
                  weight="regular"
                  loading={deleting}
                  onPress={confirmDelete}
                />
              ) : null}
            </>
          ) : null}
        </DeliveryOutcome>
        <RateRiderSheet
          visible={showRatingSheet}
          saving={savingRating}
          onSkip={() => setRatingSkipped(true)}
          onSubmit={(stars) => {
            void (async () => {
              if (!accessToken) {
                return;
              }
              setSavingRating(true);
              try {
                const saved = await customerDeliveryRepository.rateDelivery(accessToken, outcomeDelivery.id, stars);
                setRatingStars(saved.stars);
              } catch (caught: unknown) {
                setActionError(errorMessage(caught, 'This rating could not be saved.'));
              } finally {
                setSavingRating(false);
              }
            })();
          }}
        />
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

  if (liveMap && shown) {
    return (
      <MarketplaceDelivery
        delivery={shown}
        accessToken={accessToken}
        loadError={error}
        pendingRiderName={confirmed?.delivery.id === shown.id ? confirmed.riderName : null}
        showRiderConfirmation={route.params.riderConfirmed === true}
        onContinueConfirmation={() => navigation.setParams({ riderConfirmed: false })}
        onRefreshDelivery={reload}
        refreshing={isRefreshing}
        onBack={() => navigation.goBack()}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <DeliveryDetailFrame
        onBack={() => navigation.goBack()}
        overlap={awaitingOffers ? 28 : 100}
        autoGrowOffers={awaitingOffers}
        topOutline
        onSheetHeight={setOffersSheetHeight}
        header={awaitingOffers && shown ? (
          <View style={{ flex: 1 }}>
            <RidersMap
              customerLocation={shown.pickupLatitude !== null && shown.pickupLongitude !== null ? { latitude: shown.pickupLatitude, longitude: shown.pickupLongitude } : null}
              pickupLocation={shown.pickupLatitude !== null && shown.pickupLongitude !== null ? { latitude: shown.pickupLatitude, longitude: shown.pickupLongitude } : null}
              showCustomerMarker={false}
              interactive={false}
              neighborhoodView
              bottomPadding={offersSheetHeight}
              searchPulse
              riders={[
                ...offers.flatMap((bid) => (
                  bid.status === 'OPEN' && bid.mapPoint
                    ? [{ id: bid.id, latitude: bid.mapPoint.latitude, longitude: bid.mapPoint.longitude }]
                    : []
                )),
                ...nearby.points.map((point) => ({
                  id: point.id,
                  latitude: point.latitude,
                  longitude: point.longitude,
                })),
              ]}
            />

          </View>
        ) : undefined}
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
            <View style={styles.offersIntro}>
              <View style={styles.offersHeading}>
                <Text style={styles.offerCount}>{receivedOfferCountLabel(offers.length)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Sort offers, ${selectedOfferSort.label}`}
                  onPress={() => setSortOpen(true)}
                  style={styles.offerSort}
                >
                  <MaterialDesignIcons name="swap-vertical" size={18} color={colors.text} />
                  <Text style={styles.offerSortLabel}>{selectedOfferSort.shortLabel}</Text>
                  <MaterialDesignIcons name={selectedOfferSort.icon} size={18} color={colors.text} />
                  <MaterialDesignIcons name="chevron-down" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
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
        {delivery && !awaitingOffers ? (
          <View style={view === 'offline' ? styles.offlineSummary : styles.overlap}>
            <Summary delivery={delivery} />
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
                onDecline={() => { void incoming.dismiss(bid); }}
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
          <View style={styles.sentNotice}>
            <View style={styles.requestIcon}>
              <MaterialDesignIcons name="check" size={24} color={colors.primary} />
            </View>
            <Text style={styles.title}>Looking for your rider</Text>
            <Text style={styles.support}>Your request is live. Offers will appear here as riders respond.</Text>
          </View>
        ) : null}
        {awaitingOffers ? (
          <View style={styles.offersToolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel request"
              disabled={cancelling}
              hitSlop={8}
              onPress={confirmCancelSearch}
            >
              <Text style={styles.cancelRequestLink}>{cancelling ? 'Cancelling' : 'Cancel request'}</Text>
            </Pressable>
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
        ) : null}
      </DeliveryDetailFrame>
      <ConfirmRiderSheet
        bid={pendingConfirm}
        loading={confirmRiderSheetState(incoming.acceptingId, pendingConfirm?.id ?? null).loading}
        onKeepComparing={() => {
          if (incoming.acceptingId !== null) {
            return;
          }
          setPendingConfirm(null);
        }}
        onConfirm={() => {
          if (!pendingConfirm) {
            return;
          }
          void incoming.choose(pendingConfirm);
        }}
      />
      <ParcelDetailsSheet
        delivery={detailsOpen ? delivery : null}
        cancelling={cancelling}
        onClose={() => setDetailsOpen(false)}
        onCancel={confirmCancelSearch}
      />
      <BottomSheetModal visible={sortOpen} onClose={() => setSortOpen(false)} closeLabel="Close sort">
        <View style={[styles.sheet, { paddingBottom: bottomContentInset(insets.bottom) }]}>
          <Text style={styles.sortTitle}>Sort by</Text>
          <View accessibilityRole="radiogroup">
            {OFFER_SORTS.map((item) => {
              const selected = item.id === offerSort;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setOfferSort(item.id);
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
                  <View style={[styles.sortRadio, selected && styles.sortRadioSelected]}>
                    {selected ? <MaterialDesignIcons name="check" size={14} color={colors.textInverse} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </BottomSheetModal>
      <DialogModal
        visible={prompt !== null}
        onClose={() => setPrompt(null)}
        closeLabel="Dismiss"
      >
        <DialogTitle>{prompt === 'delete' ? 'Delete this delivery?' : 'Cancel this request?'}</DialogTitle>
        <DialogBody>{prompt === 'delete' ? 'This cannot be undone.' : 'We will stop looking for a rider.'}</DialogBody>
        <DialogActions>
          <DialogTextButton
            label={prompt === 'delete' ? 'Cancel' : 'Keep request'}
            tone="neutral"
            weight={prompt === 'delete' ? 'regular' : 'bold'}
            onPress={() => setPrompt(null)}
          />
          <DialogTextButton
            label={prompt === 'delete' ? 'Delete' : 'Cancel request'}
            tone="danger"
            weight={prompt === 'delete' ? 'bold' : 'regular'}
            onPress={() => {
              const next = prompt;
              setPrompt(null);
              if (next === 'delete') {
                void deleteDelivery();
              } else {
                void stopSearch();
              }
            }}
          />
        </DialogActions>
      </DialogModal>
    </View>
  );
}

function headline(
  view: ReturnType<typeof riderSearchView>,
  delivery: CustomerDeliveryDetail | null,
): string {
  if (view === 'assigned') {
    return 'Rider coming';
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
  onDecline,
}: {
  bid: CustomerBid;
  accessToken: string | null;
  busy: boolean;
  loading: boolean;
  onChoose: () => void;
  onDecline: () => void;
}) {
  const eta = pickupEtaLabel(bid.pickupEtaSeconds);
  const etaReady = eta !== 'ETA unavailable';
  const summary = riderRatingLine(bid);
  const classTone = riderClassColors[bid.riderClass];
  const { width, fontScale } = useWindowDimensions();
  const badgeBesideName = width >= 360 && fontScale < 1.3;
  const badge = (
    <View style={[styles.classPill, { backgroundColor: classTone.background }]}>
      <Text style={[styles.classPillText, { color: classTone.text }]}>{riderClassLabel(bid.riderClass)}</Text>
    </View>
  );
  return (
    <View style={[styles.card, styles.offerCard]}>
      <View style={styles.offerIdentity}>
        <RiderPortrait
          name={bid.riderName}
          initials={riderInitials(bid.riderName)}
          path={bid.hasProfilePhoto ? bidProfilePhotoPath(bid.deliveryId, bid.id) : null}
          accessToken={accessToken}
          style={styles.offerAvatar}
          textStyle={styles.initials}
        />
        <View style={styles.offerCopy}>
          <View style={styles.offerNameRow}>
            <Text numberOfLines={1} style={styles.offerName}>{bid.riderName}</Text>
            {badgeBesideName ? badge : null}
          </View>
          {badgeBesideName ? null : badge}
          {bid.motorcycle ? <Text numberOfLines={1} style={styles.offerMeta}>{bid.motorcycle}</Text> : null}
          <View style={styles.offerRatingRow}>
            <MaterialDesignIcons name="star" size={14} color="#E8A317" />
            {summary.rating ? <Text style={styles.offerRating}>{summary.rating}</Text> : null}
            {summary.rating ? <Text style={styles.offerMeta}>·</Text> : null}
            <Text numberOfLines={1} style={styles.offerRides}>{summary.rides}</Text>
          </View>
        </View>
        <View style={styles.offerPriceBlock}>
          <Text numberOfLines={1} style={[styles.offerPrice, styles.offerCardPrice]}>${bid.amount}</Text>
          <View style={styles.offerEta}>
            {etaReady ? <MaterialDesignIcons name="clock-outline" size={14} color={colors.textSecondary} /> : null}
            <Text style={styles.offerEtaText}>{eta}</Text>
          </View>
        </View>
      </View>
      {bidCanAccept(bid) ? (
        <View style={styles.offerActions}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onDecline} hitSlop={8} style={styles.declineHit}>
            <Text style={styles.decline}>Decline</Text>
          </Pressable>
          <PrimaryButton
            label="Choose Rider"
            compact
            labelStyle={styles.chooseLabel}
            loading={loading}
            disabled={busy}
            onPress={onChoose}
          />
        </View>
      ) : (
        <Text style={styles.offerMeta}>This offer is no longer available.</Text>
      )}
    </View>
  );
}

function ConfirmRiderSheet({
  bid,
  loading,
  onKeepComparing,
  onConfirm,
}: {
  bid: CustomerBid | null;
  loading: boolean;
  onKeepComparing: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogModal visible={bid !== null} onClose={onKeepComparing} closeLabel="Keep comparing">
      {bid ? (
        <>
          <DialogTitle>Choose rider</DialogTitle>
          <DialogBody>{bid.riderName}</DialogBody>
          <Text style={styles.confirmPrice}>${bid.amount}</Text>
          <DialogActions>
            <DialogTextButton label="Keep comparing" tone="neutral" disabled={loading} onPress={onKeepComparing} />
            <DialogTextButton
              label={loading ? 'Confirming' : 'Confirm rider'}
              loading={loading}
              onPress={onConfirm}
            />
          </DialogActions>
        </>
      ) : null}
    </DialogModal>
  );
}

function RateRiderSheet({
  visible,
  saving,
  onSkip,
  onSubmit,
}: {
  visible: boolean;
  saving: boolean;
  onSkip: () => void;
  onSubmit: (stars: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [stars, setStars] = useState(0);
  useEffect(() => {
    if (visible) {
      setStars(0);
    }
  }, [visible]);
  return (
    <BottomSheetModal visible={visible} onClose={onSkip} closeLabel="Skip rating">
      <View style={[styles.sheet, { paddingBottom: bottomContentInset(insets.bottom) }]}>
        <Text style={styles.sortTitle}>Rate your rider</Text>
        <Text style={styles.offerMeta}>Optional. Skipping does not change this delivery.</Text>
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
              disabled={saving}
              onPress={() => setStars(value)}
            >
              <MaterialDesignIcons
                name={value <= stars ? 'star' : 'star-outline'}
                size={32}
                color={value <= stars ? '#E8A317' : colors.border}
              />
            </Pressable>
          ))}
        </View>
        <PrimaryButton
          label="Submit"
          loading={saving}
          disabled={stars < 1}
          onPress={() => onSubmit(stars)}
        />
        <SecondaryButton label="Skip" bordered={false} disabled={saving} onPress={onSkip} />
      </View>
    </BottomSheetModal>
  );
}

function OfferSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.offerIdentity}>
        <View style={styles.offerAvatar} />
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
    backgroundColor: '#F7FCF9',
    overflow: 'hidden',
  },
  deliveryMap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  deliveryMapWash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  offerScroll: {
    flex: 1,
    backgroundColor: 'transparent',
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
    alignItems: 'stretch',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  notice: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  offerList: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  offersIntro: {
    alignSelf: 'stretch',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  offersToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  cancelRequestLink: {
    fontSize: typography.button,
    fontWeight: '400',
    color: colors.error,
  },
  offersHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  offerCount: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
    color: colors.text,
  },
  offerSort: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  offerSortLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.text,
  },
  parcelDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  parcelDetailsText: {
    fontSize: typography.button,
    fontWeight: '500',
    color: colors.primary,
  },
  offerIdentity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  offerEta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    maxWidth: '100%',
  },
  offerEtaText: {
    flexShrink: 1,
    fontSize: typography.caption,
    lineHeight: 18,
    textAlign: 'right',
    color: colors.textSecondary,
  },
  offerRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: spacing.xs,
  },
  offerRating: {
    fontSize: typography.caption,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.text,
  },
  classPill: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  classPillCenter: {
    alignSelf: 'center',
  },
  classPillText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  offerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  declineHit: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  chooseLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  decline: {
    fontSize: typography.button,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  ratedNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  ratedNote: {
    fontSize: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  offerCard: {
    overflow: 'hidden',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  offerCopy: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  offerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: spacing.xs,
  },
  offerAvatar: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
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
    flexShrink: 1,
    minWidth: 0,
    fontSize: typography.body,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.text,
    includeFontPadding: false,
  },
  offerRides: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: typography.caption,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  offerCardPrice: {
    fontSize: 22,
    lineHeight: 26,
    includeFontPadding: false,
  },
  offerMeta: {
    fontSize: typography.caption,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  offerPriceBlock: {
    alignItems: 'flex-end',
    flexShrink: 0,
    maxWidth: 132,
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
  sortTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  confirmPrice: {
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 26,
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
  sortRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortRadioSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
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
  sentNotice: {
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  requestIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  overlap: {
    marginTop: -spacing.xxxl,
    marginHorizontal: spacing.lg,
  },
  offlineSummary: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
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
