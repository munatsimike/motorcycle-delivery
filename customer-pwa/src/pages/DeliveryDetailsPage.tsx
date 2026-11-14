import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../auth/sessionContext';
import { ErrorMessage } from '../components/ErrorMessage';
import { TopSpinner } from '../components/TopSpinner';
import { acceptOffer, adjustOffer, cancelDelivery, deliveryErrorMessage, dismissOffer, loadDelivery, loadDeliveryRoute, loadOffers, rateDelivery, searchForRider } from '../deliveries/api';
import { RiderPhoto } from '../deliveries/RiderPhoto';
import { TrackingMap } from '../deliveries/TrackingMap';
import { fetchNearbyRiders } from '../home/nearbyApi';
import { beginPageTransition } from '../motion/pageTransition';
import { motionClass, usePresence } from '../motion/usePresence';
import {
  TRACKING_POLL_MS,
  arrivalLabel,
  customerOfferForBooking,
  deliveryActions,
  deliveryScreen,
  detailViewState,
  acceptanceKeyFor,
  bidCanAccept,
  clearAcceptanceKey,
  createAcceptanceGate,
  duplicateAcceptanceNotice,
  keepsRiderLocation,
  keepsAcceptanceKey,
  offerFieldText,
  offersMissingSince,
  offerRiderName,
  pickupEtaLabel,
  riderBikeLine,
  riderClassLabel,
  riderRatingLine,
  riderDialUrl,
  riderWhatsAppUrl,
  roadDistanceLabel,
  shouldPollDelivery,
  shouldShowRiderConfirmed,
  showsCompletedRoute,
  showsDeliveredDestination,
  statusBandCopy,
  showsRiderOffers,
  sortRiderOffers,
  trackingHeadline,
  trackingMapView,
  trackingSubtitle,
  type CustomerBid,
  type CustomerDeliveryDetail,
  type OfferSort,
  type RoutePoint,
} from '../deliveries/tracking';
import {
  contentLabel,
  deliveryCardAddress,
  deliveryCardStatusLabel,
  deliveryContentKind,
  deliveryDistanceLabel,
  deliveryOutcomeSupport,
  deliveryOutcomeTitle,
  deliveryStatusTone,
  deliveryWhenLabel,
  moneyLabel,
  outcomeShowsRider,
  shortDeliveryReference,
} from '../deliveries/rules';

export function DeliveryDetailsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { accessToken } = useSession();
  const [delivery, setDelivery] = useState<CustomerDeliveryDetail | null>(null);
  const [offers, setOffers] = useState<CustomerBid[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [parcelOpen, setParcelOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'cancel' | 'delete' | CustomerBid>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [offerSort, setOfferSort] = useState<OfferSort>('price');
  const [sortOpen, setSortOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceText, setPriceText] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [confirmedDismissed, setConfirmedDismissed] = useState(false);
  const [offersLoaded, setOffersLoaded] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [offerNotice, setOfferNotice] = useState<string | null>(null);
  const [nearby, setNearby] = useState<RoutePoint[]>([]);
  const [routeLine, setRouteLine] = useState<RoutePoint[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<CustomerDeliveryDetail | null>(null);
  const seenOffers = useRef<string[]>([]);
  const accepting = useRef(createAcceptanceGate());
  const busyRef = useRef(false);
  const cancelTriggerRef = useRef<HTMLButtonElement>(null);
  const keepRequestRef = useRef<HTMLButtonElement>(null);
  const cancelDialogRef = useRef<HTMLDivElement>(null);
  const chooseTriggerRef = useRef<HTMLButtonElement>(null);
  const keepComparingRef = useRef<HTMLButtonElement>(null);
  const riderDialogRef = useRef<HTMLDivElement>(null);
  const riderHistory = useRef(false);
  latest.current = delivery;

  useEffect(() => {
    if (confirm !== 'cancel' || !showsRiderOffers(latest.current)) return undefined;
    keepRequestRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (busyRef.current) return;
        event.preventDefault();
        setConfirmError(null);
        setConfirm(null);
        return;
      }
      if (event.key !== 'Tab' || !cancelDialogRef.current) return;
      const items = [...cancelDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      cancelTriggerRef.current?.focus();
    };
  }, [confirm]);

  useEffect(() => {
    const riderOpen = confirm !== null && confirm !== 'cancel' && confirm !== 'delete';
    if (!riderOpen) {
      if (riderHistory.current) {
        riderHistory.current = false;
        chooseTriggerRef.current?.focus();
        if (window.history.state?.chooseRiderDialog === true) window.history.back();
      }
      return undefined;
    }
    keepComparingRef.current?.focus();
    if (!riderHistory.current) {
      window.history.pushState({ chooseRiderDialog: true }, '');
      riderHistory.current = true;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (busyRef.current) return;
        event.preventDefault();
        setConfirmError(null);
        setConfirm(null);
        return;
      }
      if (event.key !== 'Tab' || !riderDialogRef.current) return;
      const items = [...riderDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function onPop() {
      if (busyRef.current) {
        window.history.pushState({ chooseRiderDialog: true }, '');
        return;
      }
      setConfirmError(null);
      setConfirm(null);
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
    };
  }, [confirm]);

  useEffect(() => {
    let stopped = false;
    async function load() {
      if (document.visibilityState === 'hidden') return;
      const current = latest.current;
      if (current && !shouldPollDelivery(current) && !showsRiderOffers(current)) return;
      const token = await accessToken();
      if (stopped) return;
      if (!token) {
        setToken(null);
        setError('Delivery details are unavailable.');
        setIsLoading(false);
        return;
      }
      setToken(token);
      try {
        const loaded = await loadDelivery(token, id);
        if (stopped) return;
        latest.current = loaded;
        setDelivery(loaded);
        setError(null);
        if (showsRiderOffers(loaded)) {
          try {
            const bids = await loadOffers(token, id);
            if (!stopped) {
              const open = bids.filter((bid) => bid.status === 'OPEN');
              const ids = open.map((bid) => bid.id);
              if (offersMissingSince(seenOffers.current, ids)) setOfferNotice('An offer is no longer available.');
              seenOffers.current = ids;
              setOffers(open);
              setOffersError(null);
              setOffersLoaded(true);
            }
          } catch (caught) {
            if (!stopped) {
              setOffersError(deliveryErrorMessage(caught, 'Offers are unavailable.'));
              setOffersLoaded(true);
            }
          }
        } else if (!stopped) {
          setOffers([]);
          seenOffers.current = [];
          setOffersLoaded(true);
          setOffersError(null);
          setOfferNotice(null);
        }
        if (!stopped && loaded.status === 'PICKED_UP') {
          const line = await loadDeliveryRoute(token, id).catch(() => []);
          if (!stopped) setRouteLine(line);
        }
      } catch (caught) {
        if (!stopped && !latest.current) setError(deliveryErrorMessage(caught, 'Delivery details are unavailable.'));
      } finally {
        if (!stopped) setIsLoading(false);
      }
    }
    latest.current = null;
    seenOffers.current = [];
    setOfferNotice(null);
    setDelivery(null);
    setIsLoading(true);
    void load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setNow(Date.now());
      void load();
    }, TRACKING_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accessToken, attempt, id]);

  useEffect(() => {
    if (!delivery || !showsRiderOffers(delivery) || delivery.pickupLatitude === null || delivery.pickupLongitude === null) return undefined;
    const latitude = delivery.pickupLatitude;
    const longitude = delivery.pickupLongitude;
    let stopped = false;
    async function loadNearby() {
      const token = await accessToken();
      if (!token || stopped) return;
      try {
        const result = await fetchNearbyRiders(token, latitude, longitude);
        if (!stopped) setNearby(result.points.map((point) => ({ latitude: point.latitude, longitude: point.longitude })));
      } catch {
        if (!stopped) setNearby([]);
      }
    }
    void loadNearby();
    const timer = window.setInterval(() => { void loadNearby(); }, 20_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [accessToken, delivery]);

  useEffect(() => {
    if (acceptedId !== id || confirmedDismissed) return undefined;
    const timer = window.setTimeout(() => setConfirmedDismissed(true), 2400);
    return () => window.clearTimeout(timer);
  }, [acceptedId, confirmedDismissed, id]);

  const trackingClock = delivery !== null && keepsRiderLocation(delivery.status);
  useEffect(() => {
    if (!trackingClock) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [trackingClock]);

  const confirmSnapshot = useRef(confirm);
  if (confirm) confirmSnapshot.current = confirm;
  const shownConfirm = confirm ?? confirmSnapshot.current;
  const riderSnapshot = useRef<CustomerBid | null>(null);
  if (confirm !== null && confirm !== 'cancel' && confirm !== 'delete') riderSnapshot.current = confirm;
  const shownRider = confirm !== null && confirm !== 'cancel' && confirm !== 'delete' ? confirm : riderSnapshot.current;
  const requestDialog = confirm === 'cancel' && showsRiderOffers(delivery);
  const riderDialog = confirm !== null && confirm !== 'cancel' && confirm !== 'delete';
  const sheetConfirm = confirm === 'delete' || (confirm === 'cancel' && !requestDialog);
  const parcelMotion = usePresence(parcelOpen, 220);
  const sortMotion = usePresence(sortOpen, 220);
  const priceMotion = usePresence(priceOpen, 150);
  const requestMotion = usePresence(requestDialog, 150);
  const riderMotion = usePresence(riderDialog, 150);
  const confirmMotion = usePresence(sheetConfirm, 150);
  const view = detailViewState({ isLoading, error, hasDelivery: delivery !== null });
  if (view === 'loading') {
    return (
      <div className="track page-stage is-entering">
        <div className="track-loading">
          <TopSpinner active label="Loading delivery" />
          <p aria-hidden="true">Loading delivery</p>
        </div>
      </div>
    );
  }
  if (view === 'error' || !delivery) {
    return (
      <div className="track page-stage is-entering">
        <Link className="fullscreen-back" to="/deliveries" aria-label="Back">
          <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
          </svg>
        </Link>
        <ErrorMessage>{error ?? 'Delivery details are unavailable.'}</ErrorMessage>
        <button type="button" className="deliveries-retry" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
      </div>
    );
  }

  const screen = deliveryScreen(delivery);
  const orderedOffers = sortRiderOffers(offers, offerSort);
  const confirmed = shouldShowRiderConfirmed(acceptedId, delivery.id, confirmedDismissed);
  const actions = deliveryActions(delivery, now);
  const mapView = trackingMapView(delivery, now);
  const live = mapView.kind === 'live';
  const showsMap = showsCompletedRoute(delivery)
    || showsDeliveredDestination(delivery)
    || (screen === 'offers' && delivery.pickupLatitude !== null && delivery.pickupLongitude !== null)
    || (screen !== 'outcome' && mapView.kind !== 'hidden');
  const approach = live ? delivery.pickupApproach : null;
  const headline = trackingHeadline(delivery.status, approach?.metres);
  const subtitle = trackingSubtitle(headline, delivery.dropoffAddress);
  const distance = approach ? roadDistanceLabel(approach.metres) : null;
  const eta = approach ? arrivalLabel(approach.seconds) : null;
  const summary = [distance, eta].filter((part): part is string => Boolean(part)).join(' · ') || null;
  const currentDelivery = delivery;
  async function withToken(task: (token: string) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error('Sign in again.');
      await task(token);
      setConfirm(null);
    } catch (caught) {
      setActionError(deliveryErrorMessage(caught, 'This action could not be completed.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function openPrice() {
    if (busyRef.current) return;
    setPriceText(currentDelivery.customerOffer ?? currentDelivery.suggestedPrice);
    setPriceError(null);
    setPriceOpen(true);
  }

  async function savePrice() {
    const submitted = customerOfferForBooking(priceText);
    if ('error' in submitted) {
      setPriceError(submitted.error);
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPriceError(null);
    try {
      const sessionToken = await accessToken();
      if (!sessionToken) throw new Error('Sign in again.');
      await adjustOffer(sessionToken, currentDelivery.id, submitted.offeredPrice);
      try {
        setDelivery(await loadDelivery(sessionToken, currentDelivery.id));
      } catch {
        setPriceError('Your price was saved, but this delivery could not be refreshed.');
        return;
      }
      setPriceOpen(false);
    } catch (caught) {
      setPriceError(deliveryErrorMessage(caught, 'This offer could not be saved.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function cancelRequest() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setConfirmError(null);
    try {
      const sessionToken = await accessToken();
      if (!sessionToken) throw new Error('Sign in again.');
      await cancelDelivery(sessionToken, currentDelivery.id);
      beginPageTransition(() => navigate('/deliveries', { replace: true }));
    } catch (caught) {
      setConfirmError(deliveryErrorMessage(caught, 'This request could not be cancelled.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function deleteRequest() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setConfirmError(null);
    try {
      const sessionToken = await accessToken();
      if (!sessionToken) throw new Error('Sign in again.');
      await cancelDelivery(sessionToken, currentDelivery.id);
      beginPageTransition(() => navigate('/deliveries', { replace: true }));
    } catch (caught) {
      setConfirmError(deliveryErrorMessage(caught, 'This delivery could not be deleted.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function confirmRider(bid: CustomerBid) {
    if (busyRef.current) return;
    const started = accepting.current.begin();
    const blocked = duplicateAcceptanceNotice(started);
    if (blocked) {
      setConfirmError(blocked);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setConfirmError(null);
    try {
      const sessionToken = await accessToken();
      if (!sessionToken) throw new Error('Sign in again.');
      const key = acceptanceKeyFor(sessionStorage, currentDelivery.id, bid.id, () => crypto.randomUUID());
      let accepted;
      try {
        accepted = await acceptOffer(sessionToken, currentDelivery.id, bid.id, key);
      } catch (caught) {
        if (!keepsAcceptanceKey(caught)) throw caught;
        const latestDelivery = await loadDelivery(sessionToken, currentDelivery.id);
        if (latestDelivery.status !== 'RIDER_ASSIGNED' && latestDelivery.status !== 'COLLECTING') throw caught;
        clearAcceptanceKey(sessionStorage, currentDelivery.id, bid.id);
        setDelivery(latestDelivery);
        setAcceptedId(latestDelivery.id);
        setConfirmedDismissed(false);
        setConfirm(null);
        return;
      }
      if (accepted.deliveryId !== currentDelivery.id || accepted.bidId !== bid.id) {
        throw new Error('This offer could not be accepted.');
      }
      clearAcceptanceKey(sessionStorage, currentDelivery.id, bid.id);
      setDelivery((current) => current ? { ...current, status: 'RIDER_ASSIGNED', offeredPrice: accepted.acceptedBidAmount, riderLocation: null } : current);
      const next = await loadDelivery(sessionToken, currentDelivery.id).catch(() => null);
      if (next) setDelivery(next);
      setAcceptedId(currentDelivery.id);
      setConfirmedDismissed(false);
      setConfirm(null);
    } catch (caught) {
      setConfirmError(deliveryErrorMessage(caught, 'This offer could not be accepted.'));
    } finally {
      accepting.current.end();
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function searchAgain() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSearching(true);
    setActionError(null);
    try {
      const sessionToken = await accessToken();
      if (!sessionToken) throw new Error('Sign in again.');
      await searchForRider(sessionToken, currentDelivery.id);
      try {
        setDelivery(await loadDelivery(sessionToken, currentDelivery.id));
      } catch {
        setActionError('The search started, but this delivery could not be refreshed.');
        return;
      }
    } catch (caught) {
      setActionError(deliveryErrorMessage(caught, 'The search could not be started.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setSearching(false);
    }
  }

  return (
    <div className={screen === 'tracking' ? 'track track-live page-stage is-entering' : showsMap ? 'track page-stage is-entering' : 'track track-plain page-stage is-entering'}>
      {showsMap ? null : <div className="track-wash" aria-hidden="true" />}
      <Link className="fullscreen-back" to="/deliveries" aria-label="Back">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
        </svg>
      </Link>
      {showsCompletedRoute(delivery) ? (
        <TrackingMap
          deliveryId={delivery.id}
          live={false}
          rider={null}
          stop={{ latitude: delivery.dropoffLatitude ?? 0, longitude: delivery.dropoffLongitude ?? 0 }}
          pickup={{ latitude: delivery.pickupLatitude ?? 0, longitude: delivery.pickupLongitude ?? 0 }}
          headingToDropoff
          line={routeLine.length > 1 ? routeLine : [
            { latitude: delivery.pickupLatitude ?? 0, longitude: delivery.pickupLongitude ?? 0 },
            { latitude: delivery.dropoffLatitude ?? 0, longitude: delivery.dropoffLongitude ?? 0 },
          ]}
          summary={null}
          stroke="#1A73E8"
        />
      ) : null}
      {showsDeliveredDestination(delivery) ? (
        <TrackingMap
          deliveryId={delivery.id}
          live={false}
          rider={null}
          stop={{ latitude: delivery.dropoffLatitude ?? 0, longitude: delivery.dropoffLongitude ?? 0 }}
          headingToDropoff
          line={[]}
          summary={null}
          deliveredCallout={{
            name: delivery.recipientName?.trim() ?? '',
            address: deliveryCardAddress(delivery.dropoffAddress),
            when: delivery.completedAt ? deliveryWhenLabel(delivery.completedAt) : '',
          }}
        />
      ) : null}
      {screen === 'offers' && delivery.pickupLatitude !== null && delivery.pickupLongitude !== null ? (
        <TrackingMap
          deliveryId={delivery.id}
          live={false}
          rider={null}
          stop={{ latitude: delivery.pickupLatitude, longitude: delivery.pickupLongitude }}
          headingToDropoff={false}
          line={[]}
          summary={null}
          extraMarkers={[
            ...orderedOffers.flatMap((bid) => bid.mapPoint ? [{ ...bid.mapPoint, title: bid.riderName }] : []),
            ...nearby.map((point) => ({ ...point, title: 'Available rider' })),
          ]}
          neighborhood
          interactive={false}
        />
      ) : null}
      {screen !== 'outcome' && mapView.kind !== 'hidden' ? (
        <TrackingMap
          deliveryId={mapView.deliveryId}
          live={live}
          rider={mapView.kind === 'live' ? mapView.rider : null}
          stop={mapView.stop}
          headingToDropoff={mapView.headingToDropoff}
          line={approach?.line ?? []}
          summary={summary}
        />
      ) : null}
      {screen === 'status' ? (
        <section className="status-band" aria-label="Delivery status">
          <div className="status-hero">
            <span className="status-hero-icon" aria-hidden="true">{delivery.status === 'ASSIGNED' ? <BikeMark /> : <ContentMark kind="parcel" />}</span>
            <h1>{statusBandCopy(delivery.status).title}</h1>
            <p>{statusBandCopy(delivery.status).support}</p>
          </div>
          <DeliveryFacts delivery={delivery} />
        </section>
      ) : null}
      {screen === 'status' ? null : <section className={screen === 'offers' ? 'track-sheet track-offers-sheet' : 'track-sheet'} aria-label="Delivery details">
        {screen === 'offers' ? <div className="offers-handle" aria-hidden="true" /> : null}
        {screen === 'outcome' && delivery.status === 'DELIVERED' ? (
          <DeliveredSummary delivery={delivery} />
        ) : screen === 'outcome' ? (
          <OutcomeSummary
            delivery={delivery}
            accessToken={token}
            onParcel={() => setParcelOpen(true)}
            onAdjust={openPrice}
          />
        ) : (
          <>
            {confirmed && screen === 'tracking' ? (
              <div className="rider-confirmed-note">
                <span className="rider-confirmed-mark" aria-hidden="true"><CheckMark /></span>
                <span>
                  <strong>Rider confirmed!</strong>
                  <p>Your rider has been assigned to your delivery.</p>
                </span>
              </div>
            ) : null}
            {delivery.serviceClass === 'EXPRESS' ? <p className="track-kicker">Urgent</p> : null}
            <div className="track-title-row">
              <h1>{headline ?? deliveryCardStatusLabel({ status: delivery.status, serviceClass: delivery.serviceClass, deliverBy: delivery.deliverBy, openBidCount: offers.length })}</h1>
              {live ? <p className="track-live-pill">Live</p> : null}
              {screen === 'offers' ? (
                <button type="button" className="offer-sort" aria-label={`Sort offers, ${offerSortLabel(offerSort)}`} onClick={() => setSortOpen(true)}>
                  <SwapIcon />
                  <span>{offerSortShortLabel(offerSort)}</span>
                  <SortIcon descending={offerSort.endsWith('high')} />
                  <ChevronDown />
                </button>
              ) : null}
            </div>
            {subtitle ? <p>{subtitle}</p> : null}
            {screen === 'tracking' && deadlineLabel(delivery.deliverBy) ? <p className="track-note">Deliver by {deadlineLabel(delivery.deliverBy)}</p> : null}
            {screen === 'tracking' && !delivery.offeredPrice ? <p className="track-note">Riders offer their own price. This suggestion is not the agreed price.</p> : null}
          </>
        )}
        {screen !== 'outcome' && delivery.rider && headline ? (
          <div className="track-rider">
            <RiderPhoto
              tile
              name={delivery.rider.name}
              hasProfilePhoto={delivery.rider.hasProfilePhoto}
              path={delivery.rider.hasProfilePhoto ? `/customers/me/deliveries/${encodeURIComponent(delivery.id)}/rider-profile-photo` : null}
              accessToken={token}
            />
            <div>
              <strong>{delivery.rider.name}</strong>
              {riderBikeLine(delivery.rider.motorcycle, delivery.rider.registrationNumber) ? <p>{riderBikeLine(delivery.rider.motorcycle, delivery.rider.registrationNumber)}</p> : null}
              {delivery.rider.colour ? <p>{delivery.rider.colour}</p> : null}
            </div>
            {actions.contact ? (
              <ContactLinks
                phone={delivery.rider.phone}
                callLabel={`Call ${delivery.rider.name}`}
                whatsAppLabel={`WhatsApp ${delivery.rider.name}`}
              />
            ) : null}
          </div>
        ) : null}
        {screen === 'offers' ? (
          <div className="track-offers">
            {offerNotice ? <p className="track-meta">{offerNotice}</p> : null}
            {!offersLoaded && orderedOffers.length === 0 ? (
              <div className="offer-skeletons" role="status" aria-label="Loading offers">
                <span />
                <span />
              </div>
            ) : null}
            {offersError ? <ErrorMessage>{offersError}</ErrorMessage> : null}
            {offersLoaded && offersError && orderedOffers.length === 0 ? (
              <button type="button" className="deliveries-retry" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
            ) : null}
            {offersLoaded && !offersError && orderedOffers.length === 0 ? (
              <div className="offers-empty">
                <div className="offers-check" aria-hidden="true"><CheckMark /></div>
                <h2>Looking for your rider</h2>
                <p>Your request is live. Offers will appear here as riders respond.</p>
              </div>
            ) : null}
            {orderedOffers.map((bid) => {
              const rating = riderRatingLine(bid);
              const canAccept = bidCanAccept(bid);
              return (
              <article key={bid.id}>
                <div className="offer-identity">
                <RiderPhoto
                  tile
                  name={bid.riderName}
                  hasProfilePhoto={bid.hasProfilePhoto}
                  path={bid.hasProfilePhoto ? `/customers/me/deliveries/${encodeURIComponent(delivery.id)}/bids/${encodeURIComponent(bid.id)}/profile-photo` : null}
                  accessToken={token}
                />
                <div className="offer-copy">
                  <div className="offer-name-row">
                    <strong>{offerRiderName(bid.riderName)}</strong>
                    <span className={`offer-class offer-class-${bid.riderClass.toLowerCase()}`}>{riderClassLabel(bid.riderClass)}</span>
                  </div>
                  {bid.motorcycle ? <p>{bid.motorcycle}</p> : null}
                  <p className="offer-rating-row">
                    <span className="offer-star" aria-hidden="true">★</span>
                    {rating.rating ? <span className="offer-rating">{rating.rating}</span> : null}
                    {rating.rating ? <span aria-hidden="true">·</span> : null}
                    <span>{rating.rides}</span>
                  </p>
                </div>
                <div className="offer-price">
                  <span>${bid.amount}</span>
                  <p className="offer-eta">{pickupEtaLabel(bid.pickupEtaSeconds) === 'ETA unavailable' ? null : <ClockMark />}<span>{pickupEtaLabel(bid.pickupEtaSeconds)}</span></p>
                </div>
                </div>
                {canAccept ? (
                <div className="offer-actions">
                  <button type="button" className="offer-decline" disabled={busy} onClick={() => void withToken(async (sessionToken) => {
                    await dismissOffer(sessionToken, delivery.id, bid.id);
                    seenOffers.current = seenOffers.current.filter((item) => item !== bid.id);
                    setOffers((current) => current.filter((item) => item.id !== bid.id));
                  })}>Decline</button>
                  <button type="button" className="offer-choose" disabled={busy} onClick={(event) => { if (busy) return; setConfirmError(null); chooseTriggerRef.current = event.currentTarget; setConfirm(bid); }}>Choose Rider</button>
                </div>
                ) : <p>This offer is no longer available.</p>}
              </article>
              );
            })}
          </div>
        ) : null}
        {screen === 'tracking' ? <div className="facts-divider" /> : null}
        <div className={screen === 'outcome' ? 'outcome-actions' : screen === 'tracking' || screen === 'offers' ? 'track-actions track-footer' : 'track-actions'}>
          {actions.cancel || actions.offers ? <button ref={actions.offers ? cancelTriggerRef : undefined} type="button" onClick={() => { if (busyRef.current) return; setConfirmError(null); setConfirm('cancel'); }}>{busy ? 'Cancelling' : actions.offers ? 'Cancel request' : 'Cancel delivery'}</button> : null}
          {actions.searchAgain ? <button type="button" className="outcome-search" disabled={busy} onClick={() => void searchAgain()}><SearchIcon />{searching ? 'Searching…' : 'Search again'}</button> : null}
          {actions.deleteRequest ? <button type="button" className="outcome-delete" disabled={busy} onClick={() => { if (busyRef.current) return; setConfirmError(null); setConfirm('delete'); }}>Delete</button> : null}
          {actions.adjustPrice && screen !== 'outcome' ? <button type="button" disabled={busy} onClick={openPrice}>Adjust price</button> : null}
          {actions.parcel && screen !== 'outcome' ? <button type="button" className="track-parcel" onClick={() => setParcelOpen(true)}>Parcel details<ChevronUp /></button> : null}
        </div>
        {actions.rate ? (
          <div className="track-rating" aria-label="Rate rider">
            {[1, 2, 3, 4, 5].map((stars) => (
              <button key={stars} type="button" onClick={() => void withToken(async (token) => { await rateDelivery(token, delivery.id, stars); setDelivery(await loadDelivery(token, delivery.id)); })}>{stars}</button>
            ))}
          </div>
        ) : null}
        {actionError ? <ErrorMessage>{actionError}</ErrorMessage> : null}
      </section>}
      {parcelMotion.mounted ? (
        <div className={motionClass('deliveries-sheet-backdrop', 'sheet', parcelMotion.visible)} onClick={() => setParcelOpen(false)}>
          <div className="deliveries-sheet" role="dialog" aria-label="Parcel details" onClick={(event) => event.stopPropagation()}>
            <div className="parcel-sheet-head">
              <h2>Parcel details</h2>
              <button type="button" className="parcel-sheet-close" aria-label="Close" onClick={() => setParcelOpen(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" /></svg>
              </button>
            </div>
            <DeliveryFacts delivery={delivery} showContacts />
          </div>
        </div>
      ) : null}
      {requestMotion.mounted ? (
        <div className={motionClass('confirm-dialog-backdrop', 'dialog', requestMotion.visible)} onClick={() => { if (busy) return; setConfirmError(null); setConfirm(null); }}>
          <div
            ref={cancelDialogRef}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-request-title"
            aria-describedby="cancel-request-copy"
            aria-busy={busy}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="cancel-request-title">Cancel this request?</h2>
            <p id="cancel-request-copy">We will stop looking for a rider.</p>
            {confirmError ? <ErrorMessage>{confirmError}</ErrorMessage> : null}
            <div className="confirm-dialog-actions">
              <button ref={keepRequestRef} type="button" className="confirm-keep" disabled={busy} onClick={() => { if (busy) return; setConfirmError(null); setConfirm(null); }}>Keep request</button>
              <button type="button" className="confirm-cancel" disabled={busy} onClick={() => void cancelRequest()}>{busy ? 'Cancelling' : 'Cancel request'}</button>
            </div>
          </div>
        </div>
      ) : null}
      {riderMotion.mounted && shownRider ? (
        <div className={motionClass('confirm-dialog-backdrop', 'dialog', riderMotion.visible)} onClick={() => { if (busy) return; setConfirmError(null); setConfirm(null); }}>
          <div
            ref={riderDialogRef}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="choose-rider-title"
            aria-describedby="choose-rider-copy"
            aria-busy={busy}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="choose-rider-title">Choose rider?</h2>
            <p id="choose-rider-copy">Confirm that you want this rider to handle your delivery.</p>
            <div className="confirm-rider">
              <strong>{shownRider.riderName}</strong>
              <span>${shownRider.amount}</span>
            </div>
            {confirmError ? <ErrorMessage>{confirmError}</ErrorMessage> : null}
            <div className="confirm-dialog-actions">
              <button ref={keepComparingRef} type="button" className="confirm-keep" disabled={busy} onClick={() => { if (busy) return; setConfirmError(null); setConfirm(null); }}>Keep comparing</button>
              <button type="button" className="confirm-accept" disabled={busy} onClick={() => void confirmRider(shownRider)}>{busy ? 'Confirming…' : 'Confirm rider'}</button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmMotion.mounted && (shownConfirm === 'cancel' || shownConfirm === 'delete') ? (
        <div className={motionClass('deliveries-sheet-backdrop', 'dialog', confirmMotion.visible)} onClick={() => { if (busy && shownConfirm === 'delete') return; setConfirmError(null); setConfirm(null); }}>
          <div className="deliveries-sheet" role="dialog" aria-label="Confirm" onClick={(event) => event.stopPropagation()}>
            <h2>{shownConfirm === 'cancel' ? 'Cancel delivery?' : 'Delete this delivery?'}</h2>
            <p>{shownConfirm === 'cancel' ? 'Cancelling closes this delivery request.' : 'This cannot be undone.'}</p>
            {shownConfirm === 'delete' && confirmError ? <ErrorMessage>{confirmError}</ErrorMessage> : null}
            <button type="button" disabled={busy && shownConfirm !== 'delete'} onClick={() => { if (!busy) { setConfirmError(null); setConfirm(null); } }}>{shownConfirm === 'delete' ? 'Cancel' : 'Keep delivery'}</button>
            <button type="button" disabled={busy} onClick={() => {
              if (shownConfirm === 'delete') {
                void deleteRequest();
                return;
              }
              void withToken(async (token) => {
                await cancelDelivery(token, delivery.id);
                beginPageTransition(() => navigate('/deliveries', { replace: true }));
              });
            }}>{busy ? 'Confirming' : shownConfirm === 'delete' ? 'Delete' : 'Cancel delivery'}</button>
          </div>
        </div>
      ) : null}
      {sortMotion.mounted ? (
        <div className={motionClass('deliveries-sheet-backdrop', 'sheet', sortMotion.visible)} onClick={() => setSortOpen(false)}>
          <div className="deliveries-sheet" role="dialog" aria-label="Sort by" onClick={(event) => event.stopPropagation()}>
            <h2>Sort by</h2>
            {([
              ['price', 'Price: lowest to highest', false],
              ['price-high', 'Price: highest to lowest', true],
              ['rides-low', 'Rides: lowest to highest', false],
              ['rides-high', 'Rides: highest to lowest', true],
            ] as const).map(([id, label, descending]) => (
              <button key={id} type="button" className={offerSort === id ? 'sort-option is-selected' : 'sort-option'} onClick={() => { setOfferSort(id); setSortOpen(false); }}>
                <SortIcon descending={descending} />
                {label}
                <span className="sort-radio">{offerSort === id ? <CheckMark /> : null}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {priceMotion.mounted ? (
        <div className={motionClass('deliveries-sheet-backdrop', 'dialog', priceMotion.visible)}>
          <div className="deliveries-sheet" role="dialog" aria-label="Adjust price">
            <h2>Your offer ($)</h2>
            <input inputMode="decimal" maxLength={7} value={priceText} onChange={(event) => { setPriceText(offerFieldText(event.target.value)); setPriceError(null); }} />
            {priceError ? <ErrorMessage>{priceError}</ErrorMessage> : null}
            <button type="button" disabled={busy} onClick={() => setPriceOpen(false)}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => void savePrice()}>{busy ? 'Saving' : 'Save price'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OutcomeSummary({
  delivery,
  accessToken,
  onParcel,
  onAdjust,
}: {
  delivery: CustomerDeliveryDetail;
  accessToken: string | null;
  onParcel: () => void;
  onAdjust: () => void;
}) {
  const tone = deliveryStatusTone(delivery.status);
  const rider = outcomeShowsRider(delivery.status) ? delivery.rider : null;
  const inTransit = deliveryOutcomeTitle(delivery.status) === 'In transit';
  const customerOffer = delivery.status === 'NO_RIDER_FOUND';
  return (
    <div className="outcome">
      <div className="outcome-status">
        <span className={customerOffer ? 'outcome-icon outcome-icon-no-rider' : 'outcome-icon'} style={customerOffer ? undefined : { background: tone.background, color: tone.color }} aria-hidden="true">
          <StatusGlyph status={delivery.status} />
        </span>
        <h1 style={{ color: tone.color, fontWeight: delivery.status === 'CANCELLED' ? 500 : 700 }}>{deliveryOutcomeTitle(delivery.status)}</h1>
        <p>{deliveryOutcomeSupport(delivery.status)}</p>
      </div>
      {rider ? (
        <div className="track-rider">
          <RiderPhoto
            tile
            name={rider.name}
            hasProfilePhoto={rider.hasProfilePhoto}
            path={rider.hasProfilePhoto ? `/customers/me/deliveries/${encodeURIComponent(delivery.id)}/rider-profile-photo` : null}
            accessToken={accessToken}
          />
          <div>
            <strong>{rider.name}</strong>
            {rider.motorcycle ? <p>{rider.motorcycle}</p> : null}
          </div>
          {riderDialUrl(rider.phone) ? (
            <ContactLinks phone={rider.phone} callLabel={`Call ${rider.name}`} whatsAppLabel={`WhatsApp ${rider.name}`} />
          ) : null}
        </div>
      ) : null}
      {inTransit ? (
        <button type="button" className="outcome-parcel" onClick={onParcel}>Parcel details<ChevronUp /></button>
      ) : (
        <DeliveryFacts delivery={delivery} customerOffer={customerOffer} onAdjust={customerOffer ? onAdjust : undefined} />
      )}
    </div>
  );
}

function DeliveredSummary({ delivery }: { delivery: CustomerDeliveryDetail }) {
  const kind = deliveryContentKind(delivery.parcelDescription);
  const when = delivery.createdAt ? deliveryWhenLabel(delivery.createdAt) : '';
  const amount = (delivery.offeredPrice?.trim() || delivery.suggestedPrice).trim();
  const reference = shortDeliveryReference(delivery.id).replace(/^#/, '');
  const message = `Hello, I have a question or complaint about delivery #${reference}.`;
  return (
    <div className="delivered-summary">
      <div className="facts-badge">
        <span className="facts-kind"><ContentMark kind={kind} />{contentLabel(kind)}</span>
        {delivery.serviceClass ? (
          <span className="delivery-class">{delivery.serviceClass === 'EXPRESS' ? <FlashMark /> : <MessageMark />}{delivery.serviceClass === 'EXPRESS' ? 'Urgent' : 'Flexible'}</span>
        ) : null}
      </div>
      <div className="delivery-facts">
        <p><span>Delivery</span><strong>{shortDeliveryReference(delivery.id)}</strong></p>
        {when ? <p><span>Requested</span><strong>{when}</strong></p> : null}
      </div>
      {delivery.senderName?.trim() || delivery.pickupAddress ? (
        <p className="delivery-stop">
          <PinMark dropoff={false} />
          <span className="stop-copy">
            {delivery.senderName?.trim() ? <strong>{delivery.senderName.trim()}</strong> : null}
            {delivery.pickupAddress ? <span>{deliveryCardAddress(delivery.pickupAddress)}</span> : null}
          </span>
        </p>
      ) : null}
      <div className="facts-divider" />
      <div className="delivery-facts delivery-price">
        <p><span>Distance</span><strong>{deliveryDistanceLabel(delivery.distanceMeters)}</strong></p>
        <p><span>Price</span><strong>{amount ? moneyLabel(delivery.currency, amount) : 'Unavailable'}</strong></p>
      </div>
      <div className="facts-divider" />
      <div className="support-row">
        <p>Questions or complaints?</p>
        <ContactLinks phone={SUPPORT_PHONE} message={message} callLabel="Call support" whatsAppLabel="WhatsApp support" />
      </div>
    </div>
  );
}

function DeliveryFacts({
  delivery,
  showContacts = false,
  customerOffer = false,
  onAdjust,
}: {
  delivery: CustomerDeliveryDetail;
  showContacts?: boolean;
  customerOffer?: boolean;
  onAdjust?: () => void;
}) {
  const when = delivery.createdAt ? deliveryWhenLabel(delivery.createdAt) : '';
  const amount = customerOffer
    ? (delivery.customerOffer?.trim() || delivery.suggestedPrice)
    : (delivery.offeredPrice ?? delivery.suggestedPrice);
  const kind = deliveryContentKind(delivery.parcelDescription);
  const urgent = delivery.serviceClass === 'EXPRESS';
  return (
    <div className="delivery-facts-card">
      <div className="facts-badge">
        <span className="facts-kind"><ContentMark kind={kind} />{contentLabel(kind)}</span>
        {delivery.serviceClass ? (
          <span className="delivery-class">{urgent ? <FlashMark /> : <MessageMark />}{urgent ? 'Urgent' : 'Flexible'}</span>
        ) : null}
        <strong>{shortDeliveryReference(delivery.id)}</strong>
      </div>
      {when ? <p className="facts-date"><CalendarMark />{when}</p> : null}
      <p className="delivery-stop"><PinMark dropoff={false} /><span>{showContacts && delivery.senderName ? `${delivery.senderName}, ` : ''}{deliveryCardAddress(delivery.pickupAddress)}</span></p>
      <p className="delivery-stop"><PinMark dropoff /><span>{showContacts && delivery.recipientName ? `${delivery.recipientName}, ` : ''}{deliveryCardAddress(delivery.dropoffAddress)}</span></p>
      <div className="facts-divider" />
      <div className="delivery-facts">
        <p><span>Distance</span><strong>{deliveryDistanceLabel(delivery.distanceMeters)}</strong></p>
        <p className="facts-price">
          <span>{customerOffer ? 'Your offer' : 'Price'}</span>
          <strong>{moneyLabel(delivery.currency, amount)}</strong>
          {onAdjust ? <button type="button" className="facts-adjust" onClick={onAdjust}><PencilMark />Adjust price</button> : null}
        </p>
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: CustomerDeliveryDetail['status'] }) {
  if (status === 'NO_RIDER_FOUND') {
    return <svg viewBox="0 0 24 24"><path d="M12 20a8 8 0 1 0-8-8 8 8 0 0 0 8 8m0-18a10 10 0 1 1-10 10A10 10 0 0 1 12 2m.5 5v5.25l4.5 2.67-.75 1.23L11 13V7h1.5Z" /></svg>;
  }
  if (status === 'DELIVERED') {
    return <svg viewBox="0 0 24 24"><path d="M21 7 9 19l-5.5-5.5 1.41-1.41L9 16.17 19.59 5.59 21 7Z" /></svg>;
  }
  if (status === 'CANCELLED') {
    return <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" /></svg>;
  }
  if (status === 'FAILED') {
    return <svg viewBox="0 0 24 24"><path d="M11 15h2v2h-2v-2m0-8h2v6h-2V7m1-5a10 10 0 1 0 10 10A10 10 0 0 0 12 2m0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24"><path d="M12 2 2 7v10l10 5 10-5V7L12 2Zm0 2.2 7.2 3.8L12 11.8 4.8 8 12 4.2ZM4 9.4l7 3.6v7.1l-7-3.6V9.4Zm9 10.7v-7.1l7-3.6v7.1l-7 3.6Z" /></svg>;
}

function BikeMark() {
  return <svg viewBox="0 0 24 24"><path d="M19 7a2 2 0 0 0-2-2h-3v2h3v2.65L13.52 14H10V9H6a4 4 0 0 0-4 4v3h2a3 3 0 0 0 6 0h4.48L19 10.35V7M7 17a1 1 0 0 1-1-1h2a1 1 0 0 1-1 1m12-4a3 3 0 1 0 3 3 3 3 0 0 0-3-3m0 4a1 1 0 1 1 1-1 1 1 0 0 1-1 1Z" /></svg>;
}

function ContentMark({ kind }: { kind: 'parcel' | 'document' | 'food' }) {
  if (kind === 'food') return <svg viewBox="0 0 24 24"><path d="M8 3v8a2 2 0 0 1-2 2H5v8h2v-6h1a4 4 0 0 0 4-4V3H8Zm8 0c-1.2 2.2-2 4.4-2 7a4 4 0 0 0 2 3.4V21h2v-7.2A6.8 6.8 0 0 0 20 10c0-2.6-1.2-5-4-7Z" /></svg>;
  if (kind === 'document') return <svg viewBox="0 0 24 24"><path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6Zm0 2h7v5h5v11H6V4Zm2 8v2h8v-2H8Zm0 4v2h5v-2H8Z" /></svg>;
  return <svg viewBox="0 0 24 24"><path d="M12 2 2 7v10l10 5 10-5V7L12 2Zm0 2.2 7.2 3.8L12 11.8 4.8 8 12 4.2ZM4 9.4l7 3.6v7.1l-7-3.6V9.4Zm9 10.7v-7.1l7-3.6v7.1l-7 3.6Z" /></svg>;
}

function MessageMark() {
  return <svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H6l-2 2V4h16v12ZM6 12h12v2H6v-2Zm0-3h12v2H6V9Zm0-3h12v2H6V6Z" /></svg>;
}

function FlashMark() {
  return <svg viewBox="0 0 24 24"><path d="M11.5 20 16.4 10.3H13V4L8.5 13.7h3V20M15 2H9v2h2V2h4m2 0v2h-2V2h2M7 2v2H5V2h2M7 6V4H5v2h2M5 8V6H3v2h2M5 10V8H3v2h2M7 12v-2H5v2h2M9 14v-2H7v2h2M11 16v-2H9v2h2M13 18v-2h-2v2h2M15 20v-2h-2v2h2M17 22v-2h-2v2h2M19 10V8h-2v2h2M17 6V4h2v2h-2M17 8V6h2v2h-2Z" /></svg>;
}

function CalendarMark() {
  return <svg viewBox="0 0 24 24"><path d="M19 19H5V8h14m-3-7v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1m1 11h-5v5h5v-5Z" /></svg>;
}

function PinMark({ dropoff }: { dropoff: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ color: dropoff ? '#1A73E8' : '#169B62' }}>
      <path d="M12 2.8a6.2 6.2 0 0 0-6.2 6.2c0 4.7 6.2 12.2 6.2 12.2s6.2-7.5 6.2-12.2A6.2 6.2 0 0 0 12 2.8Zm0 8.4a2.2 2.2 0 1 1 2.2-2.2 2.2 2.2 0 0 1-2.2 2.2Z" />
    </svg>
  );
}

function PencilMark() {
  return <svg viewBox="0 0 24 24"><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25Z" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.52 6.52 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3m0 2A4.5 4.5 0 1 0 14 9.5 4.5 4.5 0 0 0 9.5 5Z" fill="currentColor" /></svg>;
}

function ChevronUp() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41Z" fill="currentColor" /></svg>;
}

function ChevronDown() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z" fill="currentColor" /></svg>;
}

function SwapIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 5 7h3v10H5l4 4 4-4h-3V7h3L9 3m6 0-4 4h3v10h-3l4 4 4-4h-3V7h3l-4-4Z" fill="currentColor" /></svg>;
}

function SortIcon({ descending }: { descending: boolean }) {
  return descending
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7h3L18 3l-4 4h3v14h2M11 13H9v8H7v-8H5l4-4 4 4H11Z" fill="currentColor" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 17h3l-4 4-4-4h3V3h2M11 13H9V3H7v10H5l4 4 4-4H11Z" fill="currentColor" /></svg>;
}

function ClockMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20a8 8 0 1 0-8-8 8 8 0 0 0 8 8m0-18a10 10 0 1 1-10 10A10 10 0 0 1 12 2m.5 5v5.25l4.5 2.67-.75 1.23L11 13V7h1.5Z" fill="currentColor" /></svg>;
}

function CheckMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 7 9 19l-5.5-5.5 1.41-1.41L9 16.17 19.59 5.59 21 7Z" fill="currentColor" /></svg>;
}

function ContactLinks({
  phone,
  message,
  callLabel,
  whatsAppLabel,
}: {
  phone: string | null;
  message?: string;
  callLabel: string;
  whatsAppLabel: string;
}) {
  const call = riderDialUrl(phone);
  const chat = riderWhatsAppUrl(phone);
  if (!call || !chat) return null;
  const whatsApp = message ? `${chat}?text=${encodeURIComponent(message)}` : chat;
  return (
    <div className="track-contact">
      <a className="track-icon-btn" href={call} aria-label={callLabel}><PhoneIcon /></a>
      <a className="track-icon-btn" href={whatsApp} aria-label={whatsAppLabel}><WhatsAppIcon /></a>
    </div>
  );
}

function PhoneIcon() {
  return <svg viewBox="0 0 24 24"><path d="M6.62 10.79a15.1 15.1 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.59.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .57 3.59 1 1 0 0 1-.25 1l-2.2 2.2Z" /></svg>;
}

function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12.04 2A9.9 9.9 0 0 0 2.15 11.8c0 1.74.46 3.44 1.34 4.94L2 22l5.39-1.41a10 10 0 0 0 4.65 1.18h.01A9.9 9.9 0 0 0 21.94 11.8 9.9 9.9 0 0 0 12.04 2m5.8 13.86c-.24.68-1.4 1.25-1.94 1.33-.5.07-1.12.1-1.81-.11-.41-.13-.95-.31-1.63-.61-2.87-1.24-4.74-4.13-4.88-4.32-.14-.19-1.16-1.54-1.16-2.94s.73-2.09 1-2.37c.26-.28.64-.41 1.02-.41h.33c.3 0 .44.02.64.5.24.57.82 2 .89 2.14.07.15.12.33.02.53-.1.19-.14.31-.28.48-.14.16-.29.36-.42.48-.13.14-.28.29-.12.55.16.27.71 1.16 1.51 1.88 1.04.93 1.91 1.21 2.18 1.35.27.14.42.12.58-.07.16-.19.67-.77.84-1.03.18-.26.35-.22.59-.13.23.09 1.5.71 1.76.84.26.13.44.19.5.3.07.1.07.6-.18 1.28Z" /></svg>;
}

function deadlineLabel(value: string | null): string | null {
  if (!value) return null;
  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = String(deadline.getHours()).padStart(2, '0');
  const minutes = String(deadline.getMinutes()).padStart(2, '0');
  return `${deadline.getDate()} ${months[deadline.getMonth()]} ${deadline.getFullYear()}, ${hours}:${minutes}`;
}

function offerSortLabel(sort: OfferSort): string {
  if (sort === 'price-high') return 'Price: highest to lowest';
  if (sort === 'rides-low') return 'Rides: lowest to highest';
  if (sort === 'rides-high') return 'Rides: highest to lowest';
  return 'Price: lowest to highest';
}

function offerSortShortLabel(sort: OfferSort): string {
  return sort === 'rides-low' || sort === 'rides-high' ? 'Rides' : 'Price';
}

const SUPPORT_PHONE = '+263772569226';
