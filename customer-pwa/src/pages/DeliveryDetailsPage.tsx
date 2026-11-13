import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../auth/sessionContext';
import { ErrorMessage } from '../components/ErrorMessage';
import { acceptOffer, adjustOffer, cancelDelivery, deliveryErrorMessage, dismissOffer, loadDelivery, loadDeliveryRoute, loadOffers, rateDelivery, searchForRider } from '../deliveries/api';
import { RiderPhoto } from '../deliveries/RiderPhoto';
import { TrackingMap } from '../deliveries/TrackingMap';
import { fetchNearbyRiders } from '../home/nearbyApi';
import {
  TRACKING_POLL_MS,
  arrivalLabel,
  customerOfferForBooking,
  deliveryActions,
  deliveryScreen,
  detailViewState,
  locationAgeLabel,
  acceptanceKeyFor,
  bidCanAccept,
  clearAcceptanceKey,
  createAcceptanceGate,
  duplicateAcceptanceNotice,
  keepsRiderLocation,
  keepsAcceptanceKey,
  offerFieldText,
  offersMissingSince,
  pickupEtaLabel,
  receivedOfferCountLabel,
  riderBikeLine,
  riderClassLabel,
  riderRatingLine,
  riderDialUrl,
  riderFixIsFresh,
  riderWhatsAppUrl,
  roadDistanceLabel,
  shouldPollDelivery,
  shouldShowRiderConfirmed,
  showsCompletedRoute,
  showsDeliveredDestination,
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
  latest.current = delivery;

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

  const trackingClock = delivery !== null && keepsRiderLocation(delivery.status);
  useEffect(() => {
    if (!trackingClock) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [trackingClock]);

  const view = detailViewState({ isLoading, error, hasDelivery: delivery !== null });
  if (view === 'loading') {
    return <div className="track"><p className="track-status" role="status">Loading delivery</p></div>;
  }
  if (view === 'error' || !delivery) {
    return (
      <div className="track">
        <Link className="fullscreen-back" to="/deliveries">Back to deliveries</Link>
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
  const updated = delivery.riderLocation && riderFixIsFresh(delivery.riderLocation.updatedAt, now)
    ? locationAgeLabel(delivery.riderLocation.updatedAt, now)
    : null;

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

  return (
    <div className={screen === 'tracking' ? 'track track-live' : showsMap ? 'track' : 'track track-plain'}>
      <Link className="fullscreen-back" to="/deliveries">Back to deliveries</Link>
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
      <section className="track-sheet" aria-label="Delivery details">
        {screen === 'outcome' && delivery.status === 'DELIVERED' ? (
          <DeliveredSummary delivery={delivery} />
        ) : screen === 'outcome' ? (
          <OutcomeSummary
            delivery={delivery}
            accessToken={token}
            onParcel={() => setParcelOpen(true)}
            onAdjust={() => {
              setPriceText(delivery.customerOffer ?? delivery.suggestedPrice);
              setPriceError(null);
              setPriceOpen(true);
            }}
          />
        ) : (
          <>
            {delivery.serviceClass === 'EXPRESS' ? <p className="track-kicker">Urgent</p> : null}
            <h1>{headline ?? deliveryCardStatusLabel({ status: delivery.status, serviceClass: delivery.serviceClass, deliverBy: delivery.deliverBy, openBidCount: offers.length })}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
            {updated ? <p className="track-meta">{updated}</p> : null}
            {live ? <p className="track-live">Live</p> : null}
          </>
        )}
        {screen !== 'outcome' && delivery.rider && headline ? (
          <div className="track-rider">
            <RiderPhoto
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
              <div className="track-contact">
                <a href={riderDialUrl(delivery.rider.phone) ?? undefined} aria-label={`Call ${delivery.rider.name}`}>Call</a>
                <a href={riderWhatsAppUrl(delivery.rider.phone) ?? undefined} aria-label={`WhatsApp ${delivery.rider.name}`}>WhatsApp</a>
              </div>
            ) : null}
          </div>
        ) : null}
        {screen === 'offers' ? (
          <div className="track-offers">
            <div className="track-offer-head">
              <h2>{receivedOfferCountLabel(orderedOffers.length)}</h2>
              <button type="button" aria-label={`Sort offers, ${offerSortLabel(offerSort)}`} onClick={() => setSortOpen(true)}>{offerSortShortLabel(offerSort)}</button>
            </div>
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
              <>
                <h2>Looking for your rider</h2>
                <p>Your request is live. Offers will appear here as riders respond.</p>
              </>
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
                    <strong>{bid.riderName}</strong>
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
                  <p>{pickupEtaLabel(bid.pickupEtaSeconds)}</p>
                </div>
                </div>
                {canAccept ? (
                <div className="offer-actions">
                  <button type="button" className="offer-decline" disabled={busy} onClick={() => void withToken(async (sessionToken) => {
                    await dismissOffer(sessionToken, delivery.id, bid.id);
                    seenOffers.current = seenOffers.current.filter((item) => item !== bid.id);
                    setOffers((current) => current.filter((item) => item.id !== bid.id));
                  })}>Decline</button>
                  <button type="button" className="offer-choose" disabled={busy} onClick={() => { if (!busy) setConfirm(bid); }}>Choose Rider</button>
                </div>
                ) : <p>This offer is no longer available.</p>}
              </article>
              );
            })}
          </div>
        ) : null}
        <div className={screen === 'tracking' ? 'track-actions track-footer' : 'track-actions'}>
          {actions.cancel || actions.offers ? <button type="button" onClick={() => setConfirm('cancel')}>{busy ? 'Cancelling' : actions.offers ? 'Cancel search' : 'Cancel delivery'}</button> : null}
          {actions.searchAgain ? <button type="button" onClick={() => void withToken(async (token) => { await searchForRider(token, delivery.id); setDelivery(await loadDelivery(token, delivery.id)); })}>Search again</button> : null}
          {actions.deleteRequest ? <button type="button" onClick={() => setConfirm('delete')}>Delete</button> : null}
          {actions.adjustPrice && screen !== 'outcome' ? <button type="button" onClick={() => { setPriceText(delivery.customerOffer ?? delivery.suggestedPrice); setPriceError(null); setPriceOpen(true); }}>Adjust price</button> : null}
          {actions.parcel && screen !== 'outcome' ? <button type="button" onClick={() => setParcelOpen(true)}>Parcel details</button> : null}
        </div>
        {actions.rate ? (
          <div className="track-rating" aria-label="Rate rider">
            {[1, 2, 3, 4, 5].map((stars) => (
              <button key={stars} type="button" onClick={() => void withToken(async (token) => { await rateDelivery(token, delivery.id, stars); setDelivery(await loadDelivery(token, delivery.id)); })}>{stars}</button>
            ))}
          </div>
        ) : null}
        {actionError ? <ErrorMessage>{actionError}</ErrorMessage> : null}
      </section>
      {parcelOpen ? (
        <div className="deliveries-sheet-backdrop" onClick={() => setParcelOpen(false)}>
          <div className="deliveries-sheet" role="dialog" aria-label="Parcel details" onClick={(event) => event.stopPropagation()}>
            <h2>Parcel details</h2>
            <DeliveryFacts delivery={delivery} showContacts />
            <button type="button" onClick={() => setParcelOpen(false)}>Close</button>
          </div>
        </div>
      ) : null}
      {confirm ? (
        <div className="deliveries-sheet-backdrop" onClick={() => setConfirm(null)}>
          <div className="deliveries-sheet" role="dialog" aria-label="Confirm" onClick={(event) => event.stopPropagation()}>
            <h2>{confirm === 'cancel' ? (actions.offers ? 'Cancel this request?' : 'Cancel delivery?') : confirm === 'delete' ? 'Delete this delivery?' : 'Choose rider'}</h2>
            <p>{confirm === 'cancel' ? (actions.offers ? 'We will stop looking for a rider.' : 'Cancelling closes this delivery request.') : confirm === 'delete' ? 'This cannot be undone.' : confirm.riderName}</p>
            {confirm !== 'cancel' && confirm !== 'delete' ? <p>${confirm.amount}</p> : null}
            <button type="button" disabled={busy && confirm !== 'cancel' && confirm !== 'delete'} onClick={() => { if (!busy) setConfirm(null); }}>{confirm === 'delete' ? 'Cancel' : confirm === 'cancel' && actions.offers ? 'Keep request' : confirm === 'cancel' ? 'Keep delivery' : 'Keep comparing'}</button>
            <button type="button" disabled={busy} onClick={() => void withToken(async (token) => {
              if (confirm === 'cancel' || confirm === 'delete') {
                await cancelDelivery(token, delivery.id);
                navigate('/deliveries', { replace: true });
                return;
              }
              const started = accepting.current.begin();
              const blocked = duplicateAcceptanceNotice(started);
              if (blocked) {
                setActionError(blocked);
                return;
              }
              try {
                const key = acceptanceKeyFor(sessionStorage, delivery.id, confirm.id, () => crypto.randomUUID());
                let accepted;
                try {
                  accepted = await acceptOffer(token, delivery.id, confirm.id, key);
                } catch (caught) {
                  if (!keepsAcceptanceKey(caught)) throw caught;
                  const latestDelivery = await loadDelivery(token, delivery.id);
                  if (latestDelivery.status !== 'RIDER_ASSIGNED' && latestDelivery.status !== 'COLLECTING') throw caught;
                  clearAcceptanceKey(sessionStorage, delivery.id, confirm.id);
                  setDelivery(latestDelivery);
                  setAcceptedId(latestDelivery.id);
                  setConfirmedDismissed(false);
                  setConfirm(null);
                  return;
                }
                if (accepted.deliveryId !== delivery.id || accepted.bidId !== confirm.id) {
                  throw new Error('This offer could not be accepted.');
                }
                clearAcceptanceKey(sessionStorage, delivery.id, confirm.id);
                setDelivery((current) => current ? { ...current, status: 'RIDER_ASSIGNED', offeredPrice: accepted.acceptedBidAmount, riderLocation: null } : current);
                const next = await loadDelivery(token, delivery.id).catch(() => null);
                if (next) setDelivery(next);
                setAcceptedId(delivery.id);
                setConfirmedDismissed(false);
                setConfirm(null);
              } finally {
                accepting.current.end();
              }
            })}>{busy ? 'Confirming' : confirm === 'delete' ? 'Delete' : confirm === 'cancel' ? (actions.offers ? 'Cancel request' : 'Cancel delivery') : 'Confirm rider'}</button>
          </div>
        </div>
      ) : null}
      {sortOpen ? (
        <div className="deliveries-sheet-backdrop" onClick={() => setSortOpen(false)}>
          <div className="deliveries-sheet" role="dialog" aria-label="Sort by" onClick={(event) => event.stopPropagation()}>
            <h2>Sort by</h2>
            {([
              ['price', 'Price: lowest to highest'],
              ['price-high', 'Price: highest to lowest'],
              ['rides-low', 'Rides: lowest to highest'],
              ['rides-high', 'Rides: highest to lowest'],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" className={offerSort === id ? 'is-selected' : undefined} onClick={() => { setOfferSort(id); setSortOpen(false); }}>{label}</button>
            ))}
          </div>
        </div>
      ) : null}
      {priceOpen ? (
        <div className="deliveries-sheet-backdrop">
          <div className="deliveries-sheet" role="dialog" aria-label="Adjust price">
            <h2>Your offer ($)</h2>
            <input inputMode="decimal" maxLength={7} value={priceText} onChange={(event) => { setPriceText(offerFieldText(event.target.value)); setPriceError(null); }} />
            {priceError ? <ErrorMessage>{priceError}</ErrorMessage> : null}
            <button type="button" disabled={busy} onClick={() => setPriceOpen(false)}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => {
              const submitted = customerOfferForBooking(priceText);
              if ('error' in submitted) {
                setPriceError(submitted.error);
                return;
              }
              void withToken(async (token) => {
                await adjustOffer(token, delivery.id, submitted.offeredPrice);
                setDelivery(await loadDelivery(token, delivery.id));
                setPriceOpen(false);
              });
            }}>{busy ? 'Saving' : 'Save price'}</button>
          </div>
        </div>
      ) : null}
      {confirmed ? (
        <div className="rider-confirmed-backdrop">
          <div className="rider-confirmed" role="dialog" aria-label="Rider confirmed">
            <h2>Rider confirmed!</h2>
            <p>Your rider has been assigned to your delivery.</p>
            <button type="button" onClick={() => setConfirmedDismissed(true)}>Continue</button>
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
        <span className="outcome-icon" style={{ background: tone.background, color: tone.color }} aria-hidden="true" />
        <h1 style={{ color: tone.color, fontWeight: delivery.status === 'CANCELLED' ? 500 : 700 }}>{deliveryOutcomeTitle(delivery.status)}</h1>
        <p>{deliveryOutcomeSupport(delivery.status)}</p>
      </div>
      {rider ? (
        <div className="track-rider">
          <RiderPhoto
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
            <div className="track-contact">
              <a href={riderDialUrl(rider.phone) ?? undefined} aria-label={`Call ${rider.name}`}>Call</a>
              <a href={riderWhatsAppUrl(rider.phone) ?? undefined} aria-label={`WhatsApp ${rider.name}`}>WhatsApp</a>
            </div>
          ) : null}
        </div>
      ) : null}
      {inTransit ? (
        <button type="button" className="outcome-parcel" onClick={onParcel}>Parcel details</button>
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
      <div className="delivery-badge">
        <span>{contentLabel(kind)}</span>
        {delivery.serviceClass ? <span className="delivery-class">{delivery.serviceClass === 'EXPRESS' ? 'Urgent' : 'Flexible'}</span> : null}
      </div>
      <div className="delivery-facts">
        <p><span>Delivery</span><strong>{shortDeliveryReference(delivery.id)}</strong></p>
        {when ? <p><span>Requested</span><strong>{when}</strong></p> : null}
      </div>
      <p className="delivery-stop"><span>{[delivery.senderName, deliveryCardAddress(delivery.pickupAddress)].filter(Boolean).join(', ')}</span></p>
      <div className="delivery-facts">
        <p><span>Distance</span><strong>{deliveryDistanceLabel(delivery.distanceMeters)}</strong></p>
        <p><span>Price</span><strong>{amount ? moneyLabel(delivery.currency, amount) : 'Unavailable'}</strong></p>
      </div>
      <div className="support-row">
        <p>Questions or complaints?</p>
        <div className="track-contact">
          <a href={supportDialUrl()} aria-label="Call support">Call</a>
          <a href={supportWhatsAppUrl(message)} aria-label="WhatsApp support">WhatsApp</a>
        </div>
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
  return (
    <div className="delivery-facts-card">
      <div className="delivery-badge">
        <span>{contentLabel(deliveryContentKind(delivery.parcelDescription))}</span>
        {delivery.serviceClass ? <span className="delivery-class">{delivery.serviceClass === 'EXPRESS' ? 'Urgent' : 'Flexible'}</span> : null}
        <span>{shortDeliveryReference(delivery.id)}</span>
      </div>
      {when ? <p className="track-meta">{when}</p> : null}
      <p className="delivery-stop"><span>{showContacts && delivery.senderName ? `${delivery.senderName}, ` : ''}{deliveryCardAddress(delivery.pickupAddress)}</span></p>
      <p className="delivery-stop"><span>{showContacts && delivery.recipientName ? `${delivery.recipientName}, ` : ''}{deliveryCardAddress(delivery.dropoffAddress)}</span></p>
      <div className="delivery-facts">
        <p><span>Distance</span><strong>{deliveryDistanceLabel(delivery.distanceMeters)}</strong></p>
        <p><span>{customerOffer ? 'Your offer' : 'Price'}</span><strong>{moneyLabel(delivery.currency, amount)}</strong></p>
      </div>
      {onAdjust ? <button type="button" className="outcome-parcel" onClick={onAdjust}>Adjust price</button> : null}
    </div>
  );
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

function supportDialUrl(): string {
  return `tel:${SUPPORT_PHONE}`;
}

function supportWhatsAppUrl(message: string): string {
  return `https://wa.me/${SUPPORT_PHONE.slice(1)}?text=${encodeURIComponent(message)}`;
}
