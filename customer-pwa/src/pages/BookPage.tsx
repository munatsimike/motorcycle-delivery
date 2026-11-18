import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { beginPageTransition } from '../motion/pageTransition';
import { motionClass, usePresence } from '../motion/usePresence';
import { ApiError } from '../api/client';
import { loadCustomerAccount } from '../account/profileApi';
import { offerFieldText } from '../deliveries/tracking';
import { deliveryCardAddress, deliveryContentKind, type DeliveryContentKind } from '../deliveries/rules';
import { deliveryErrorMessage } from '../deliveries/api';
import type { CustomerAccount } from '../auth/contracts';
import { useSession } from '../auth/sessionContext';
import { Button } from '../components/Button';
import { ButtonSpinner } from '../components/ButtonSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { ZimbabwePhoneField } from '../components/ZimbabwePhoneField';
import { Loading } from '../components/Loading';
import { AddressField } from '../booking/AddressField';
import { createDelivery, quoteDelivery, resolvePlace, searchPlaces } from '../booking/api';
import { mapsBrowserKey } from '../config/env';
import { loadGoogleMaps } from '../home/googleMap';
import {
  requestBookingCurrency,
  bookingPhoneDisplay,
  bookingPhoneStored,
  deliveryContactPhone,
  describeParcel,
  displayPhone,
  bookingDraftFromLocation,
  hasSelectedCoordinates,
  parcelError,
  paymentMethodLabel,
  prepareBooking,
  quoteIdentity,
  selectParcelContent,
  stopEntryError,
  v2CreateBody,
  type BookingDraft,
  type PaymentMethod,
  type PreparedStop,
  type ServiceClass,
  type StopDraft,
} from '../booking/draft';
import {
  bookingBackAction,
  bookingKeyFor,
  bookingMode,
  persistentAttemptStore,
  bookingStepIndex,
  bookingStepTitle,
  BOOKING_STEPS,
  canStartBookingSubmit,
  clearBookingAttempt,
  nextBookingStep,
  previousBookingStep,
  type AttemptStore,
  type BookingBusy,
  type BookingStep,
} from '../booking/flow';
import {
  decideAddressAutofill,
  pickupAutofillFix,
  readGeocodedAddress,
  type PlaceSuggestion,
} from '../booking/places';
import {
  automaticGpsMayApply,
  bookingSaveLabel,
  readSavedAddresses,
  savedAddressLabel,
  saveRequest,
  stopFromSavedAddress,
  type BookingSaveChoice,
  type SavedAddress,
  type SaveState,
} from '../booking/savedAddress';
import { createSavedAddress, listSavedAddresses } from '../booking/addressApi';
import {
  bookingSuccessPath,
  confirmQuoteDecision,
  formatDistance,
  moneyLabel,
  nextCustomerOffer,
  quoteResultForRequest,
  type DeliveryQuote,
} from '../booking/quote';

const LOCATION_DENIED = 'Location permission is needed to detect your pickup point.';
const LOCATION_UNAVAILABLE = 'We couldn\'t detect your location. Try again or search for your pickup address.';
const LOCATION_STREET = 'Enter the street address.';
const ATTEMPT_KEY = 'customer_delivery_create_v1';

type QuotedPrice = DeliveryQuote & { pinKey: string };

export function BookPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { accessToken } = useSession();
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [draft, setDraft] = useState<BookingDraft>(() => bookingDraftFromLocation(location.state));
  const [step, setStep] = useState<BookingStep>('pickup');
  const [quote, setQuote] = useState<QuotedPrice | null>(null);
  const [offer, setOffer] = useState({ text: '', edited: false, pinKey: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BookingBusy>(null);
  const [booked, setBooked] = useState<null | { deliveryId: string; pickup: PreparedStop; dropoff: PreparedStop }>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressesSettled, setAddressesSettled] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [saveChoice, setSaveChoice] = useState({
    pickup: emptySaveChoice(),
    dropoff: emptySaveChoice(),
    error: null as string | null,
  });
  const [inlineSaveChoice, setInlineSaveChoice] = useState({ pickup: emptySaveChoice(), dropoff: emptySaveChoice() });
  const [inlineSaveError, setInlineSaveError] = useState<string | null>(null);
  const [inlineSaveOpen, setInlineSaveOpen] = useState<'pickup' | 'dropoff' | null>(null);
  const saveDialog = usePresence(inlineSaveOpen !== null, 150);
  const saveStopRef = useRef<'pickup' | 'dropoff' | null>(null);
  if (inlineSaveOpen) saveStopRef.current = inlineSaveOpen;
  const saveStop = inlineSaveOpen ?? saveStopRef.current;
  const [keyboardInset, setKeyboardInset] = useState(0);
  const creating = useRef(false);
  const quoteRequest = useRef(0);
  const stepRef = useRef(step);
  const busyRef = useRef(busy);
  stepRef.current = step;
  busyRef.current = busy;
  const prefilled = useRef(false);
  const addressEdited = useRef(draft.pickup.address.trim() !== '' || draft.pickup.latitude.trim() !== '');
  const draftRef = useRef(draft);
  const locatingRef = useRef(false);
  const pickupAttempt = useRef(0);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  draftRef.current = draft;
  const leaving = useRef(false);
  const attempts = useRef<AttemptStore>(persistentAttemptStore(localStorage, ATTEMPT_KEY));
  const mode = bookingMode(account ? account.marketplaceEnabled : accountLoading ? null : false);

  useEffect(() => {
    let active = true;
    void accessToken().then(async (token) => {
      if (!active) return;
      if (!token) {
        setAccountLoading(false);
        setAccountError('Account details are unavailable.');
        return;
      }
      try {
        const next = await loadCustomerAccount(token);
        if (active) setAccount(next);
      } catch (caught) {
        if (active) setAccountError(caught instanceof Error ? caught.message : 'Account details are unavailable.');
      } finally {
        if (active) setAccountLoading(false);
      }
    }).catch(() => {
      if (active) {
        setAccountError('Account details are unavailable.');
        setAccountLoading(false);
      }
    });
    return () => { active = false; };
  }, [accessToken]);

  useEffect(() => {
    if (!account || prefilled.current) return;
    prefilled.current = true;
    const name = account.kind === 'BUSINESS' ? account.contactName ?? account.name : account.name;
    setDraft((current) => ({
      ...current,
      pickup: {
        ...current.pickup,
        contactName: current.pickup.contactName || name,
        contactPhone: current.pickup.contactPhone || deliveryContactPhone(account.phone) || '',
      },
    }));
  }, [account]);

  useEffect(() => {
    let active = true;
    void accessToken().then(async (token) => {
      if (!active || !token) {
        if (active) setAddressesSettled(true);
        return;
      }
      try {
        const rows = readSavedAddresses(await listSavedAddresses(token));
        if (!active) return;
        setSavedAddresses(rows);
        // New bookings use the device location by default. Saved addresses remain
        // available through the picker; an explicit selection is never overwritten.

      } catch (caught) {
        if (active) setSavedError(deliveryErrorMessage(caught, 'Saved addresses are unavailable.'));
      } finally {
        if (active) setAddressesSettled(true);
      }
    }).catch(() => {
      if (active) {
        setSavedError('Saved addresses are unavailable.');
        setAddressesSettled(true);
      }
    });
    return () => { active = false; };
  }, [accessToken]);

  useEffect(() => {
    if (mode !== 'v2' || !addressesSettled) return undefined;
    const attemptId = ++pickupAttempt.current;
    void detectPickup(false, attemptId);
    return () => {
      pickupAttempt.current += 1;
    };
  }, [addressesSettled, mode]);

  useEffect(() => {
    function holdBack() {
      if (leaving.current) return;
      const action = bookingBackAction(stepRef.current, busyRef.current);
      if (action === 'exit') return;
      window.history.pushState({ bookingHold: true }, '');
      if (action === 'previous') {
        setError(null);
        setStep(previousBookingStep(stepRef.current));
      }
    }
    window.addEventListener('popstate', holdBack);
    return () => window.removeEventListener('popstate', holdBack);
  }, []);

  useEffect(() => {
    if (leaving.current) return;
    if (busy !== null || step !== 'pickup') {
      if (window.history.state?.bookingHold !== true) window.history.pushState({ bookingHold: true }, '');
      return;
    }
    if (window.history.state?.bookingHold === true) window.history.back();
  }, [busy, step]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const sync = () => setKeyboardInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, []);

  async function detectPickup(manual: boolean, attemptId = 0) {
    const stale = () => !manual && attemptId !== pickupAttempt.current;
    if (locatingRef.current) return;
    const pickup = draftRef.current.pickup;
    if (!manual && !automaticGpsMayApply({ addressEdited: addressEdited.current, pickup })) return;
    if (!manual) {
      const permission = await geolocationPermission();
      if (stale() || permission === 'denied') return;
    }
    if (stale() || locatingRef.current) return;
    locatingRef.current = true;
    setLocating(true);
    setLocateError(null);
    try {
      const position = await readCurrentPosition();
      if (stale() || (!manual && !automaticGpsMayApply({ addressEdited: addressEdited.current, pickup: draftRef.current.pickup }))) return;
      const fix = pickupAutofillFix({
        permission: 'granted',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMetres: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        capturedAt: position.timestamp || Date.now(),
        now: Date.now(),
      });
      if (!fix) {
        if (manual) setLocateError(LOCATION_UNAVAILABLE);
        return;
      }
      const found = await lookupAddress(Number(fix.latitude), Number(fix.longitude));
      if (stale() || (!manual && !automaticGpsMayApply({ addressEdited: addressEdited.current, pickup: draftRef.current.pickup }))) return;
      const decision = decideAddressAutofill(manual ? false : addressEdited.current, found);
      if (decision.status === 'needs-street') {
        setLocateError(LOCATION_STREET);
        return;
      }
      if (decision.status !== 'apply') {
        if (manual) setLocateError(LOCATION_UNAVAILABLE);
        return;
      }
      setDraft((current) => {
        if (!manual && !automaticGpsMayApply({ addressEdited: addressEdited.current, pickup: current.pickup })) return current;
        if (manual) addressEdited.current = true;
        return {
          ...current,
          pickup: {
            ...current.pickup,
            address: decision.display,
            resolvedAddress: decision.fullAddress,
            latitude: fix.latitude,
            longitude: fix.longitude,
            approximate: false,
            precision: 'exact',
            placeId: null,
            coordinateSource: 'DEVICE_GEOCODER',
          },
        };
      });
    } catch (caught) {
      if (stale()) return;
      if (!manual) return;
      const code = typeof caught === 'object' && caught && 'code' in caught ? Number(caught.code) : 0;
      setLocateError(code === 1 ? LOCATION_DENIED : LOCATION_UNAVAILABLE);
    } finally {
      locatingRef.current = false;
      setLocating(false);
    }
  }

  function updateStop(which: 'pickup' | 'dropoff', patch: Partial<StopDraft>) {
    setError(null);
    if (patch.latitude !== undefined || patch.longitude !== undefined || patch.address !== undefined) {
      quoteRequest.current += 1;
      setQuote(null);
      setOffer({ text: '', edited: false, pinKey: null });
    }
    setDraft((current) => ({ ...current, [which]: { ...current[which], ...patch } }));
  }

  function updateDraft(patch: Partial<BookingDraft>) {
    setError(null);
    if (patch.serviceClass !== undefined) {
      quoteRequest.current += 1;
      setQuote(null);
      setOffer({ text: '', edited: false, pinKey: null });
    }
    setDraft((current) => ({ ...current, ...patch }));
  }

  function rememberQuote(next: DeliveryQuote, identity: string) {
    setQuote({ ...next, pinKey: identity });
    setOffer((current) => nextCustomerOffer({
      current: current.text,
      edited: current.edited,
      previousPinKey: current.pinKey,
      pinKey: identity,
      suggestedPrice: next.suggestedPrice,
    }));
  }

  async function loadQuote(booking: Extract<ReturnType<typeof prepareBooking>, { ok: true }>) {
    const request = quoteRequest.current + 1;
    quoteRequest.current = request;
    setBusy('quote');
    setError(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error('Sign in to search for an address.');
      const next = await quoteDelivery(token, booking.booking);
      const current = quoteResultForRequest(request, quoteRequest.current, next);
      if (!current) return false;
      rememberQuote(current, quoteIdentity(booking.booking.pinKey, booking.booking.serviceClass, booking.booking.currency));
      return true;
    } catch (caught) {
      if (quoteRequest.current === request) {
        setQuote(null);
        setError(deliveryErrorMessage(caught, 'A price could not be quoted.'));
      }
      return false;
    } finally {
      if (quoteRequest.current === request) setBusy(null);
    }
  }

  async function goNext() {
    if (busy) return;
    if (step === 'pickup' || step === 'destination') {
      const which = step === 'pickup' ? 'pickup' : 'dropoff';
      const label = step === 'pickup' ? 'pickup' : 'drop-off';
      const located = draft[which];
      if (!located.address.trim()) {
        setError(`Enter the ${label} address`);
        return;
      }
      if (!hasSelectedCoordinates(located)) {
        setError('Select an address from the suggestions.');
        return;
      }
      const details = stopEntryError(located, label);
      if (details) {
        setError(details);
        return;
      }
      setError(null);
      setStep(step === 'pickup' ? 'destination' : 'parcel');
      return;
    }
    if (step === 'parcel') {
      const validation = parcelError(draft);
      if (validation) {
        setError(validation);
        return;
      }
    }
    const prepared = prepareBooking(draft);
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    const identity = quoteIdentity(prepared.booking.pinKey, prepared.booking.serviceClass, prepared.booking.currency);
    if (step === 'parcel' && (!quote || quote.pinKey !== identity)) {
      const loaded = await loadQuote(prepared);
      if (!loaded) return;
    }
    setError(null);
    setStep(nextBookingStep(step));
  }

  async function confirm() {
    if (!canStartBookingSubmit(creating.current, busy) || leaving.current) return;
    const prepared = prepareBooking(draft);
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    const identity = quoteIdentity(prepared.booking.pinKey, prepared.booking.serviceClass, prepared.booking.currency);
    if (!quote || quote.pinKey !== identity) {
      setError('Request a price before confirming.');
      return;
    }
    creating.current = true;
    setBusy('create');
    setError(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error('The delivery could not be booked.');
      const fresh = await quoteDelivery(token, prepared.booking);
      const decision = confirmQuoteDecision({
        shown: quote,
        fresh,
        shownIdentity: quote.pinKey,
        identity,
        offerText: offer.text,
      });
      if (decision.action !== 'create') {
        if (decision.action === 'review') rememberQuote(fresh, identity);
        setError(decision.message);
        return;
      }
      const fingerprint = JSON.stringify(v2CreateBody(prepared.booking, decision.offeredPrice));
      const idempotencyKey = bookingKeyFor(attempts.current, fingerprint, () => crypto.randomUUID());
      const created = await createDelivery(token, prepared.booking, decision.offeredPrice, idempotencyKey);
      clearBookingAttempt(attempts.current);
      finish(created.id, prepared.booking.pickup, prepared.booking.dropoff);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) clearBookingAttempt(attempts.current);
      setError(deliveryErrorMessage(caught, 'The delivery could not be booked.'));
    } finally {
      creating.current = false;
      setBusy(null);
    }
  }

  function finish(deliveryId: string, pickup: PreparedStop, dropoff: PreparedStop) {
    if (leaving.current) return;
    setBooked({ deliveryId, pickup, dropoff });
  }

  function openBookedDelivery() {
    if (!booked || leaving.current) return;
    leaving.current = true;
    const path = bookingSuccessPath(booked.deliveryId);
    if (window.history.state?.bookingHold !== true) {
      beginPageTransition(() => navigate(path, { replace: true }));
      return;
    }
    const reveal = () => {
      window.removeEventListener('popstate', reveal);
      beginPageTransition(() => navigate(path, { replace: true }));
    };
    window.addEventListener('popstate', reveal);
    window.history.back();
  }

  async function saveBookedStop(side: 'pickup' | 'dropoff') {
    if (!booked) return;
    const choice = saveChoice[side];
    const body = saveRequest(booked[side], choice);
    if (!body || choice.status !== 'idle') return;
    setSaveChoice((current) => ({
      ...current,
      [side]: { ...current[side], status: 'saving' },
      error: null,
    }));
    try {
      const token = await accessToken();
      if (!token) throw new Error('The address could not be saved.');
      await createSavedAddress(token, body);
      setSaveChoice((current) => ({
        ...current,
        [side]: { ...current[side], status: 'saved' },
      }));
    } catch (caught) {
      setSaveChoice((current) => ({
        ...current,
        [side]: { ...current[side], status: 'idle' },
        error: deliveryErrorMessage(caught, 'The address could not be saved. The delivery is still booked.'),
      }));
    }
  }

  async function saveDraftStop(side: 'pickup' | 'dropoff') {
    const stop = draftRef.current[side];
    const choice = { ...inlineSaveChoice[side], label: inlineSaveChoice[side].label ?? 'HOME' };
    if (choice.status !== 'idle') return;
    const latitude = Number(stop.latitude);
    const longitude = Number(stop.longitude);
    if (!stop.address.trim() || !stop.latitude.trim() || !stop.longitude.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setInlineSaveError('Choose a valid address from the suggestions before saving.');
      return;
    }
    if (!stop.contactName.trim() || !stop.contactPhone.trim()) {
      setInlineSaveError('Enter the contact name and phone before saving.');
      return;
    }
    const body = saveRequest({
      address: stop.address.trim(), latitude, longitude,
      contactName: stop.contactName.trim(), contactPhone: stop.contactPhone.trim(),
      placeId: stop.placeId, coordinateSource: stop.coordinateSource ?? 'DEVICE_GEOCODER',
    }, choice);
    if (!body) return;
    setInlineSaveError(null);
    setInlineSaveChoice((current) => ({ ...current, [side]: { ...current[side], status: 'saving' } }));
    try {
      const token = await accessToken();
      if (!token) throw new Error('Your session is unavailable. Please sign in again.');
      await createSavedAddress(token, body);
      const latest = readSavedAddresses(await listSavedAddresses(token));
      setSavedAddresses(latest);
      setInlineSaveChoice((current) => ({ ...current, [side]: { ...current[side], status: 'saved' } }));
      setInlineSaveOpen(null);
    } catch (caught) {
      setInlineSaveChoice((current) => ({ ...current, [side]: { ...current[side], status: 'idle' } }));
      setInlineSaveError(deliveryErrorMessage(caught, 'Unable to save this address. Please try again.'));
    }
  }

  function chooseSaved(which: 'pickup' | 'dropoff', entry: SavedAddress) {
    if (which === 'pickup') {
      addressEdited.current = true;
      setLocateError(null);
    }
    updateStop(which, stopFromSavedAddress(draftRef.current[which], entry));
  }

  function goBack() {
    const action = bookingBackAction(step, busy);
    if (action === 'blocked') return;
    if (action === 'exit') {
      beginPageTransition(() => navigate('/home'));
      return;
    }
    setError(null);
    setStep(previousBookingStep(step));
  }

  if (mode === 'unavailable' || (mode === 'unknown' && !accountLoading)) {
    return (
      <section className="book page-stage is-entering">
        <div className="book-scroll">
          <div className="book-column">
            <ErrorMessage>{accountError ?? 'Express and Flexible booking is unavailable right now.'}</ErrorMessage>
          </div>
        </div>
      </section>
    );
  }

  const index = bookingStepIndex(step);
  return (
    <section className="book page-stage is-entering">
      <header className="book-header">
        <button type="button" className="book-back" aria-label="Back" disabled={busy !== null || booked !== null} onClick={goBack}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor" />
          </svg>
        </button>
        <h1>{bookingStepTitle(step)}</h1>
      </header>
      <div className="book-scroll" style={{ paddingBottom: `calc(2rem + env(safe-area-inset-bottom) + ${keyboardInset}px)` }}>
        <div className="book-column">
          <div className="book-progress" aria-label={`Step ${index + 1} of ${BOOKING_STEPS.length}`}>
            <div className="book-progress-track">
              {BOOKING_STEPS.map((item, itemIndex) => (
                <span key={item} className={itemIndex <= index ? 'book-progress-segment is-active' : 'book-progress-segment'} />
              ))}
            </div>
            <p>Step {index + 1} of {BOOKING_STEPS.length} · {bookingStepTitle(step)}</p>
          </div>
          {step === 'pickup' || step === 'destination' ? (
            <>
            {false && savedAddresses.length > 0 ? (
              <div className="book-saved">
                <p>{step === 'pickup' ? 'Saved pickup addresses' : 'Saved delivery addresses'}</p>
                <div>
                  {savedAddresses.map((entry) => (
                    <button key={entry.id} type="button" onClick={() => chooseSaved(step === 'pickup' ? 'pickup' : 'dropoff', entry)}>
                      <strong>{savedAddressLabel(entry)}</strong>
                      <span>{entry.address}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {savedError ? <p className="book-search-status" role="status">{savedError}</p> : null}
            <StopForm
              savedAddresses={savedAddresses}
              onSelectSaved={(entry) => chooseSaved(step === 'pickup' ? 'pickup' : 'dropoff', entry)}
              phoneId={step === 'pickup' ? 'pickup-phone' : 'dropoff-phone'}
              stop={step === 'pickup' ? draft.pickup : draft.dropoff}
              onChange={(patch) => updateStop(step === 'pickup' ? 'pickup' : 'dropoff', patch)}
              onManualInput={() => { if (step === 'pickup') { addressEdited.current = true; setLocateError(null); } }}
              locating={step === 'pickup' && locating}
              locateError={step === 'pickup' ? locateError : null}
              search={(text, sessionToken) => searchWithToken(accessToken, text, step === 'destination' ? placeBias(draft.pickup.latitude, draft.pickup.longitude) : null, sessionToken)}
              resolve={(placeId, sessionToken) => resolveWithToken(accessToken, placeId, sessionToken)}
            />
            <div className="book-inline-save">
              <button type="button" className="book-inline-save-toggle" onClick={() => { setInlineSaveError(null); setInlineSaveOpen(step === 'pickup' ? 'pickup' : 'dropoff'); }}>
                {inlineSaveChoice[step === 'pickup' ? 'pickup' : 'dropoff'].status === 'saved' ? 'Address saved' : 'Save address'}
              </button>
            </div>
            </>
          ) : null}
          {step === 'parcel' ? <ParcelForm draft={draft} onChange={updateDraft} /> : null}
          {step === 'review' || step === 'confirm' ? (
            <ReviewForm
              draft={draft}
              quote={quote}
              quoting={busy === 'quote'}
              offerText={offer.text}
              editable={busy === null}
              onOfferChange={(value) => {
                setError(null);
                setOffer((current) => ({ text: offerFieldText(value), edited: true, pinKey: current.pinKey }));
              }}
            />
          ) : null}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
          <div className="book-actions">
            {step === 'review' || step === 'confirm' ? (
              <Button type="button" disabled={Boolean(busy) || Boolean(booked) || !quote} onClick={() => { void confirm(); }}>
                {busy === 'create' ? <><ButtonSpinner />Booking…</> : 'Confirm'}
              </Button>
            ) : (
              <Button type="button" disabled={Boolean(busy)} onClick={() => { void goNext(); }}>
                {busy === 'quote' ? <><ButtonSpinner />Processing…</> : 'Continue'}
              </Button>
            )}
          </div>
        </div>
      </div>
      {saveDialog.mounted && saveStop ? (
        <div className={motionClass('confirm-dialog-backdrop book-save-dialog-backdrop', 'dialog', saveDialog.visible)}>
          <div className="confirm-dialog book-save-dialog" role="dialog" aria-modal="true" aria-labelledby="book-save-dialog-title">
            <h2 id="book-save-dialog-title">Save address</h2>
            <p>Choose a label for this address.</p>
            <div className="book-save-radio-row" role="radiogroup" aria-label="Address label">
              {(['HOME', 'WORK'] as const).map((label) => (
                <label key={label} className="book-save-radio-option">
                  <input type="radio" name="booking-save-label" value={label} checked={(inlineSaveChoice[saveStop].label ?? 'HOME') === label} disabled={inlineSaveChoice[saveStop].status !== 'idle'} onChange={() => setInlineSaveChoice((current) => ({ ...current, [saveStop]: { ...current[saveStop], label } }))} />
                  <span>{label === 'HOME' ? 'Home' : 'Work'}</span>
                </label>
              ))}
            </div>
            {inlineSaveError ? <p role="alert" className="book-inline-save-error">{inlineSaveError}</p> : null}
            <div className="confirm-dialog-actions">
              <button type="button" className="confirm-keep" disabled={inlineSaveChoice[saveStop].status === 'saving'} onClick={() => { setInlineSaveOpen(null); setInlineSaveError(null); }}>Cancel</button>
              <button type="button" className="confirm-accept" disabled={inlineSaveChoice[saveStop].status !== 'idle' || !bookingSaveLabel({ ...inlineSaveChoice[saveStop], label: inlineSaveChoice[saveStop].label ?? 'HOME' })} onClick={() => { void saveDraftStop(saveStop); }}>
                {inlineSaveChoice[saveStop].status === 'saving' ? <><ButtonSpinner />Saving…</> : 'Save address'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {booked ? (
        <div className="book-confirmed" role="status">
          <div className="book-confirmed-card">
            <span aria-hidden="true">✓</span>
            <p>Delivery booked</p>
            <div className="book-save-actions">
              <button type="button" onClick={openBookedDelivery}>Continue</button>
              <SaveAddressChoice
                title="Save pickup"
                choice={saveChoice.pickup}
                onChange={(choice) => setSaveChoice((current) => ({ ...current, pickup: choice, error: null }))}
                onSave={() => { void saveBookedStop('pickup'); }}
              />
              <SaveAddressChoice
                title="Save delivery"
                choice={saveChoice.dropoff}
                onChange={(choice) => setSaveChoice((current) => ({ ...current, dropoff: choice, error: null }))}
                onSave={() => { void saveBookedStop('dropoff'); }}
              />
            </div>
            {saveChoice.error ? <p>{saveChoice.error}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function emptySaveChoice(): BookingSaveChoice & { status: SaveState } {
  return { label: null, status: 'idle' };
}

function SaveAddressChoice({
  title,
  choice,
  onChange,
  onSave,
}: {
  title: string;
  choice: BookingSaveChoice & { status: SaveState };
  onChange: (choice: BookingSaveChoice & { status: SaveState }) => void;
  onSave: () => void;
}) {
  const ready = choice.status === 'idle' && bookingSaveLabel(choice) !== null;
  const labels: Array<'HOME' | 'WORK'> = ['HOME', 'WORK'];
  return (
    <div className="book-save-side">
      <p>{title}</p>
      <div className="book-save-labels" role="group" aria-label={title}>
        {labels.map((label) => (
          <button
            key={label}
            type="button"
            aria-pressed={choice.label === label}
            className={choice.label === label ? 'is-selected' : undefined}
            disabled={choice.status !== 'idle'}
            onClick={() => onChange({ ...choice, label })}
          >
            {label === 'HOME' ? 'Home' : 'Work'}
          </button>
        ))}
      </div>
      <button type="button" disabled={!ready} onClick={onSave}>
        {choice.status === 'saved' ? 'Saved' : choice.status === 'saving' ? <><ButtonSpinner />Saving…</> : 'Save to Address Book'}
      </button>
    </div>
  );
}

function StopForm({
  phoneId,
  savedAddresses,
  onSelectSaved,
  stop,
  onChange,
  onManualInput,
  locating = false,
  locateError = null,
  search,
  resolve,
}: {
  phoneId: string;
  savedAddresses: SavedAddress[];
  onSelectSaved: (entry: SavedAddress) => void;
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
  onManualInput: () => void;
  locating?: boolean;
  locateError?: string | null;
  search: (text: string, sessionToken: string) => Promise<PlaceSuggestion[]>;
  resolve: (placeId: string, sessionToken: string) => Promise<{ label: string; latitude: string; longitude: string; suburb?: string; locality?: string }>;
}) {
  return (
    <div className="book-fields">
      <AddressField savedAddresses={savedAddresses} onSelectSaved={onSelectSaved} stop={stop} onChange={onChange} onManualInput={onManualInput} locating={locating} locateError={locateError} searchPlaces={search} resolvePlace={resolve} />
      <label className="field">
        Contact name
        <input value={stop.contactName} maxLength={200} autoComplete="off" onChange={(event) => onChange({ contactName: event.target.value })} />
      </label>
      <ZimbabwePhoneField
        id={phoneId}
        label="Contact phone"
        value={bookingPhoneDisplay(stop.contactPhone)}
        autoComplete="off"
        onChange={(local) => onChange({ contactPhone: bookingPhoneStored(local) })}
      />
    </div>
  );
}

function ParcelForm({ draft, onChange }: { draft: BookingDraft; onChange: (patch: Partial<BookingDraft>) => void }) {
  const contents = [
    { label: 'Parcel', description: 'Parcel' as const, icon: PARCEL_ICON },
    { label: 'Document', description: 'Document' as const, icon: DOCUMENT_ICON },
    { label: 'Food', description: 'Food' as const, icon: FOOD_ICON },
  ];
  const classes: { value: ServiceClass; label: string }[] = [
    { value: 'FLEXIBLE', label: 'Flexible' },
    { value: 'EXPRESS', label: 'Urgent' },
  ];
  const payments: { value: PaymentMethod; label: string }[] = [
    { value: 'CASH', label: 'Cash' },
    { value: 'ECOCASH', label: 'EcoCash' },
  ];
  const currencies: { value: 'USD' | 'ZWG'; label: string }[] = [
    { value: 'USD', label: 'USD' },
    { value: 'ZWG', label: 'ZiG' },
  ];
  return (
    <div className="book-fields">
      <fieldset className="book-block">
        <legend>What are you sending?</legend>
        <div className="book-squares">
          {contents.map((content) => {
            const selected = draft.description === content.description;
            return (
              <button key={content.description} type="button" aria-pressed={selected} className={selected ? 'is-selected' : undefined} onClick={() => onChange(selectParcelContent(content.description))}>
                <svg className="book-square-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={content.icon} /></svg>
                {content.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="book-block">
        <legend>Delivery type</legend>
        <div className="book-choices">
          {classes.map((option) => (
            <label key={option.value}>
              <input type="radio" name="service-class" checked={draft.serviceClass === option.value} onChange={() => onChange({ serviceClass: option.value })} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="book-block">
        <legend>Currency</legend>
        <div className="book-choices">
          {currencies.map((option) => (
            <label key={option.value}>
              <input type="radio" name="booking-currency" checked={requestBookingCurrency(draft.currency) === option.value} onChange={() => onChange({ currency: option.value })} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="book-block">
        <legend>Payment method</legend>
        <div className="book-choices">
          {payments.map((option) => (
            <label key={option.value}>
              <input type="radio" name="payment-method" checked={(draft.paymentMethod ?? 'CASH') === option.value} onChange={() => onChange({ paymentMethod: option.value })} />
              {option.label}
            </label>
          ))}
        </div>
        <p className="book-note">Payment is made directly to the rider.</p>
      </fieldset>
    </div>
  );
}

function ReviewForm({
  draft,
  quote,
  quoting,
  offerText,
  editable,
  onOfferChange,
}: {
  draft: BookingDraft;
  quote: QuotedPrice | null;
  quoting: boolean;
  offerText: string;
  editable: boolean;
  onOfferChange: (value: string) => void;
}) {
  const urgent = draft.serviceClass === 'EXPRESS';
  return (
    <div className="book-review">
      <div className="book-route">
        <StopSummary stop={draft.pickup} dropoff={false} />
        <StopSummary stop={draft.dropoff} dropoff />
      </div>
      <dl className="book-facts">
        <div>
          <ContentMark kind={deliveryContentKind(draft.description)} />
          <dt>Sending</dt>
          <dd>{describeParcel(draft)}</dd>
        </div>
        <div>
          <ReviewIcon path={urgent ? FLASH_ICON : MESSAGE_ICON} />
          <dt>Delivery type</dt>
          <dd>{urgent ? 'Urgent' : 'Flexible'}</dd>
        </div>
        {draft.paymentMethod ? (
          <div>
            <ReviewIcon path={draft.paymentMethod === 'ECOCASH' ? PHONE_ICON : CASH_ICON} />
            <dt>Method</dt>
            <dd>{paymentMethodLabel(draft.paymentMethod)}</dd>
          </div>
        ) : null}
      </dl>
      <div className="book-price">
        {quoting ? <Loading label="Processing" /> : null}
        {quote && !quoting ? (
          <>
            <div className="book-price-row">
              <div>
                <p>Suggested price</p>
                <strong>{moneyLabel(quote.suggestedPrice, quote.currency)}</strong>
              </div>
              <div className="book-distance">
                <p>Distance</p>
                <strong>{formatDistance(quote.distanceMeters)}</strong>
              </div>
            </div>
            <label className="book-offer">
              <span>Your offer ({quote.currency === 'ZWG' ? 'ZiG' : 'US$'})</span>
              <span className="book-offer-field">
                <span aria-hidden="true">{quote.currency === 'ZWG' ? 'ZiG' : 'US$'}</span>
                <input inputMode="decimal" maxLength={7} value={offerText} disabled={!editable} placeholder="0.00" onChange={(event) => onOfferChange(event.target.value)} />
              </span>
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}

function StopSummary({ stop, dropoff }: { stop: StopDraft; dropoff: boolean }) {
  const phone = displayPhone(stop.contactPhone);
  return (
    <div className="book-stop">
      <span className="book-stop-rail">
        <svg className={dropoff ? 'book-stop-pin is-dropoff' : 'book-stop-pin is-pickup'} viewBox="0 0 24 24" aria-label={dropoff ? 'Drop-off' : 'Pickup'}>
          <path d="M12 2.2a6.2 6.2 0 0 0-6.2 6.2c0 4.7 6.2 12.2 6.2 12.2s6.2-7.5 6.2-12.2A6.2 6.2 0 0 0 12 2.2z" /><text x="12" y="11.7" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#ffffff">{dropoff ? '2' : '1'}</text>
        </svg>
      </span>
      <div className="book-stop-copy">
        <p>{deliveryCardAddress(stop.address.trim())}</p>
        {stop.contactName.trim() ? <p>{stop.contactName.trim()}</p> : null}
        {phone ? <p>{deliveryContactPhone(stop.contactPhone) ? phone : stop.contactPhone.trim()}</p> : null}
      </div>
    </div>
  );
}

const PARCEL_ICON = 'M21,16.5C21,16.88 20.79,17.21 20.47,17.38L12.57,21.82C12.41,21.94 12.21,22 12,22C11.79,22 11.59,21.94 11.43,21.82L3.53,17.38C3.21,17.21 3,16.88 3,16.5V7.5C3,7.12 3.21,6.79 3.53,6.62L11.43,2.18C11.59,2.06 11.79,2 12,2C12.21,2 12.41,2.06 12.57,2.18L20.47,6.62C20.79,6.79 21,7.12 21,7.5V16.5M12,4.15L10.11,5.22L16,8.61L17.96,7.5L12,4.15M6.04,7.5L12,10.85L13.96,9.75L8.08,6.35L6.04,7.5M5,15.91L11,19.29V12.58L5,9.21V15.91M19,15.91V9.21L13,12.58V19.29L19,15.91Z';
const DOCUMENT_ICON = 'M6,2A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6M6,4H13V9H18V20H6V4M8,12V14H16V12H8M8,16V18H13V16H8Z';
const FOOD_ICON = 'M11,9H9V2H7V9H5V2H3V9C3,11.12 4.66,12.84 6.75,12.97V22H9.25V12.97C11.34,12.84 13,11.12 13,9V2H11V9M16,6V14H18.5V22H21V2C18.24,2 16,4.24 16,6Z';
const MESSAGE_ICON = 'M20,2A2,2 0 0,1 22,4V16A2,2 0 0,1 20,18H6L2,22V4C2,2.89 2.9,2 4,2H20M4,4V17.17L5.17,16H20V4H4M6,7H18V9H6V7M6,11H15V13H6V11Z';
const FLASH_ICON = 'M7,2H17L13.5,9H17L10,22V14H7V2M9,4V12H12V14.66L14,11H10.24L13.76,4H9Z';
const CASH_ICON = 'M3,6H21V18H3V6M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9M7,8A2,2 0 0,1 5,10V14A2,2 0 0,1 7,16H17A2,2 0 0,1 19,14V10A2,2 0 0,1 17,8H7Z';
const PHONE_ICON = 'M17,19H7V5H17M17,1H7C5.89,1 5,1.89 5,3V21A2,2 0 0,0 7,23H17A2,2 0 0,0 19,21V3C19,1.89 18.1,1 17,1Z';

function ContentMark({ kind }: { kind: DeliveryContentKind }) {
  const path = kind === 'document' ? DOCUMENT_ICON : kind === 'food' ? FOOD_ICON : PARCEL_ICON;
  return <ReviewIcon path={path} content />;
}

function ReviewIcon({ path, content = false }: { path: string; content?: boolean }) {
  return (
    <svg className={content ? 'book-fact-icon is-content' : 'book-fact-icon'} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function placeBias(latitude: string, longitude: string): { latitude: number; longitude: number } | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

async function searchWithToken(
  accessToken: () => Promise<string | null>,
  text: string,
  bias: { latitude: number; longitude: number } | null,
  sessionToken: string,
) {
  const token = await accessToken();
  if (!token) throw new Error('Sign in to search for an address.');
  return searchPlaces(token, text, bias, sessionToken);
}

async function resolveWithToken(accessToken: () => Promise<string | null>, placeId: string, sessionToken: string) {
  const token = await accessToken();
  if (!token) throw new Error('Sign in to search for an address.');
  return resolvePlace(token, placeId, sessionToken);
}

function geolocationPermission(): Promise<'granted' | 'prompt' | 'denied'> {
  if (!navigator.permissions?.query) return Promise.resolve('prompt');
  return navigator.permissions.query({ name: 'geolocation' }).then((status) => (
    status.state === 'granted' || status.state === 'denied' ? status.state : 'prompt'
  )).catch(() => 'prompt');
}

function readCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: 2 });
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  });
}

type GeocodedPlace = {
  formatted_address?: string;
  address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
};

type GeocoderMaps = {
  Geocoder?: new () => {
    geocode: (
      request: { location: { lat: number; lng: number } },
      callback: (results: GeocodedPlace[] | null, status: string) => void,
    ) => void;
  };
};

async function lookupAddress(latitude: number, longitude: number) {
  await loadGoogleMaps(mapsBrowserKey());
  const Geocoder = (window as Window & { google?: { maps?: GeocoderMaps } }).google?.maps?.Geocoder;
  if (!Geocoder) return null;
  const found = await new Promise<GeocodedPlace | null>((resolve) => {
    new Geocoder().geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
      resolve(status === 'OK' ? results?.[0] ?? null : null);
    });
  });
  return readGeocodedAddress(found?.address_components, found?.formatted_address);
}


