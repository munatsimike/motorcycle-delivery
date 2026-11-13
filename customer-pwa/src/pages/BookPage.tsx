import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { loadCustomerAccount } from '../account/profileApi';
import { offerFieldText } from '../deliveries/tracking';
import { deliveryCardAddress } from '../deliveries/rules';
import { deliveryErrorMessage } from '../deliveries/api';
import type { CustomerAccount } from '../auth/contracts';
import { useSession } from '../auth/sessionContext';
import { Button } from '../components/Button';
import { ErrorMessage } from '../components/ErrorMessage';
import { ZimbabwePhoneField } from '../components/ZimbabwePhoneField';
import { Loading } from '../components/Loading';
import { createDelivery, quoteDelivery, resolvePlace, searchPlaces } from '../booking/api';
import {
  clearStopLocation,
  bookingPhoneDisplay,
  bookingPhoneStored,
  deliveryContactPhone,
  describeParcel,
  displayPhone,
  emptyBookingDraft,
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
  type ServiceClass,
  type StopDraft,
} from '../booking/draft';
import {
  bookingBackAction,
  bookingKeyFor,
  bookingMode,
  persistentAttemptStore,
  bookingNavigationDelay,
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
  acceptSearchResult,
  confirmMapPin,
  createPlaceSessionToken,
  decideAddressAutofill,
  pickupAutofillFix,
  selectedAddressLabel,
  type PlaceSuggestion,
} from '../booking/places';
import {
  bookingSuccessPath,
  confirmQuoteDecision,
  formatDistance,
  moneyLabel,
  nextCustomerOffer,
  quoteResultForRequest,
  type DeliveryQuote,
} from '../booking/quote';

const INSTRUCTION_LIMIT = 200;
const SEARCH_DELAY_MS = 500;
const ATTEMPT_KEY = 'customer_delivery_create_v1';

type QuotedPrice = DeliveryQuote & { pinKey: string };

export function BookPage() {
  const navigate = useNavigate();
  const { accessToken } = useSession();
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [draft, setDraft] = useState<BookingDraft>(emptyBookingDraft);
  const [step, setStep] = useState<BookingStep>('pickup');
  const [quote, setQuote] = useState<QuotedPrice | null>(null);
  const [offer, setOffer] = useState({ text: '', edited: false, pinKey: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BookingBusy>(null);
  const [booked, setBooked] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const creating = useRef(false);
  const quoteRequest = useRef(0);
  const stepRef = useRef(step);
  const busyRef = useRef(busy);
  stepRef.current = step;
  busyRef.current = busy;
  const prefilled = useRef(false);
  const addressEdited = useRef(false);
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
    let cancelled = false;
    async function autofill() {
      try {
        if (!navigator.permissions?.query || !navigator.geolocation) return;
        const status = await navigator.permissions.query({ name: 'geolocation' });
        if (cancelled || status.state !== 'granted') return;
        navigator.geolocation.getCurrentPosition((position) => {
          const fix = pickupAutofillFix({
            permission: 'granted',
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMetres: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
            capturedAt: position.timestamp || Date.now(),
            now: Date.now(),
          });
          const decision = decideAddressAutofill(addressEdited.current, null);
          if (!fix || cancelled || decision.status !== 'apply') return;
          setDraft((current) => {
            if (current.pickup.address.trim() || current.pickup.latitude) return current;
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
                coordinateSource: 'DEVICE_GEOCODER',
              },
            };
          });
        }, () => undefined, { enableHighAccuracy: false, timeout: 12000, maximumAge: 15000 });
      } catch {
        // Location remains optional.
      }
    }
    void autofill();
    return () => { cancelled = true; };
  }, []);

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
      rememberQuote(current, quoteIdentity(booking.booking.pinKey, booking.booking.serviceClass));
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
    const identity = quoteIdentity(prepared.booking.pinKey, prepared.booking.serviceClass);
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
    const identity = quoteIdentity(prepared.booking.pinKey, prepared.booking.serviceClass);
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
      finish(created.id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) clearBookingAttempt(attempts.current);
      setError(deliveryErrorMessage(caught, 'The delivery could not be booked.'));
    } finally {
      creating.current = false;
      setBusy(null);
    }
  }

  function finish(deliveryId: string) {
    if (leaving.current) return;
    leaving.current = true;
    const delay = bookingNavigationDelay(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const openTracking = () => {
      const path = bookingSuccessPath(deliveryId);
      if (window.history.state?.bookingHold !== true) {
        navigate(path, { replace: true });
        return;
      }
      const reveal = () => {
        window.removeEventListener('popstate', reveal);
        navigate(path, { replace: true });
      };
      window.addEventListener('popstate', reveal);
      window.history.back();
    };
    if (delay === 0) {
      openTracking();
      return;
    }
    setBooked(true);
    window.setTimeout(openTracking, delay);
  }

  function goBack() {
    const action = bookingBackAction(step, busy);
    if (action === 'blocked') return;
    if (action === 'exit') {
      navigate('/home');
      return;
    }
    setError(null);
    setStep(previousBookingStep(step));
  }

  if (mode !== 'v2') {
    return (
      <section className="book">
        <div className="book-scroll">
          <div className="book-column">
            {mode === 'unknown' && accountLoading ? <Loading label="Loading your profile" /> : (
              <ErrorMessage>{accountError ?? 'Express and Flexible booking is unavailable right now.'}</ErrorMessage>
            )}
          </div>
        </div>
      </section>
    );
  }

  const index = bookingStepIndex(step);
  return (
    <section className="book">
      <header className="book-header">
        <button type="button" className="book-back" aria-label="Back" disabled={busy !== null} onClick={goBack}>Back</button>
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
            <StopForm
              phoneId={step === 'pickup' ? 'pickup-phone' : 'dropoff-phone'}
              stop={step === 'pickup' ? draft.pickup : draft.dropoff}
              onChange={(patch) => updateStop(step === 'pickup' ? 'pickup' : 'dropoff', patch)}
              onManualInput={() => { addressEdited.current = true; }}
              search={(text, sessionToken) => searchWithToken(accessToken, text, step === 'destination' ? placeBias(draft.pickup.latitude, draft.pickup.longitude) : null, sessionToken)}
              resolve={(placeId, sessionToken) => resolveWithToken(accessToken, placeId, sessionToken)}
            />
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
              <Button type="button" disabled={Boolean(busy) || booked || !quote} onClick={() => { void confirm(); }}>
                {busy === 'create' ? 'Booking' : 'Confirm'}
              </Button>
            ) : (
              <Button type="button" disabled={Boolean(busy)} onClick={() => { void goNext(); }}>
                {busy === 'quote' ? 'Getting price' : 'Continue'}
              </Button>
            )}
          </div>
        </div>
      </div>
      {booked ? (
        <div className="book-confirmed" role="status">
          <div className="book-confirmed-card">
            <span aria-hidden="true">✓</span>
            <p>Delivery booked</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StopForm({
  phoneId,
  stop,
  onChange,
  onManualInput,
  search,
  resolve,
}: {
  phoneId: string;
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
  onManualInput: () => void;
  search: (text: string, sessionToken: string) => Promise<PlaceSuggestion[]>;
  resolve: (placeId: string, sessionToken: string) => Promise<{ label: string; latitude: string; longitude: string; suburb?: string; locality?: string }>;
}) {
  return (
    <div className="book-fields">
      <AddressField stop={stop} onChange={onChange} onManualInput={onManualInput} searchPlaces={search} resolvePlace={resolve} />
      <label className="field">
        Contact name
        <input value={stop.contactName} maxLength={200} autoComplete="name" onChange={(event) => onChange({ contactName: event.target.value })} />
      </label>
      <ZimbabwePhoneField
        id={phoneId}
        label="Contact phone"
        value={bookingPhoneDisplay(stop.contactPhone)}
        onChange={(local) => onChange({ contactPhone: bookingPhoneStored(local) })}
      />
    </div>
  );
}

function AddressField({
  stop,
  onChange,
  onManualInput,
  searchPlaces,
  resolvePlace,
}: {
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
  onManualInput: () => void;
  searchPlaces: (text: string, sessionToken: string) => Promise<PlaceSuggestion[]>;
  resolvePlace: (placeId: string, sessionToken: string) => Promise<{ label: string; latitude: string; longitude: string; suburb?: string; locality?: string }>;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const typed = useRef(false);
  const sessionToken = useRef(createPlaceSessionToken());
  const requestId = useRef(0);
  const searchRef = useRef(searchPlaces);
  const resolveRef = useRef(resolvePlace);
  searchRef.current = searchPlaces;
  resolveRef.current = resolvePlace;

  useEffect(() => {
    const text = stop.address.trim();
    if (!typed.current || (stop.latitude && stop.longitude)) {
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return undefined;
    }
    if (text.length < 3) {
      sessionToken.current = createPlaceSessionToken();
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return undefined;
    }
    const started = requestId.current + 1;
    requestId.current = started;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchRef.current(text, sessionToken.current)
        .then((next) => {
          if (!acceptSearchResult(started, requestId.current, next)) return;
          setSuggestions(next.slice(0, 10));
          setSearched(true);
          setSearchError(null);
        })
        .catch((caught: unknown) => {
          if (!acceptSearchResult(started, requestId.current, true)) return;
          setSuggestions([]);
          setSearched(false);
          setSearchError(deliveryErrorMessage(caught, 'Address suggestions are unavailable. You can type the address.'));
        })
        .finally(() => {
          if (acceptSearchResult(started, requestId.current, true)) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [stop.address, stop.latitude, stop.longitude]);

  async function selectSuggestion(suggestion: PlaceSuggestion) {
    setSearching(true);
    setSearchError(null);
    try {
      let chosen = suggestion;
      if (suggestion.placeId && !suggestion.latitude.trim()) {
        const resolved = await resolveRef.current(suggestion.placeId, suggestion.sessionToken || sessionToken.current);
        chosen = {
          ...suggestion,
          label: selectedAddressLabel(suggestion.label, resolved),
          latitude: resolved.latitude,
          longitude: resolved.longitude,
        };
      }
      if (!chosen.latitude.trim() || !chosen.longitude.trim()) {
        throw new Error('Address suggestions are unavailable. You can type the address.');
      }
      const location = confirmMapPin(chosen);
      sessionToken.current = createPlaceSessionToken();
      setSuggestions([]);
      setSearched(false);
      onChange({
        address: location.label,
        landmark: location.precision === 'exact' ? stop.landmark : stop.address.trim().slice(0, 200),
        latitude: location.latitude,
        longitude: location.longitude,
        approximate: location.precision !== 'exact',
        precision: location.precision,
        placeId: location.placeId,
        coordinateSource: 'GOOGLE_PLACES',
        resolvedAddress: '',
      });
    } catch (caught) {
      setSearchError(deliveryErrorMessage(caught, 'Address suggestions are unavailable. You can type the address.'));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="book-address">
      <label className="field">
        Address
        <input
          value={stop.address}
          maxLength={500}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          onChange={(event) => {
            typed.current = true;
            onManualInput();
            onChange(clearStopLocation(event.target.value));
          }}
        />
      </label>
      {searching ? <p className="book-search-status" role="status">Searching addresses</p> : null}
      {searchError ? <ErrorMessage>{searchError}</ErrorMessage> : null}
      {searched && !searching && suggestions.length === 0 && !searchError ? (
        <p className="book-search-status" role="status">No matching addresses.</p>
      ) : null}
      {suggestions.length > 0 ? (
        <ul className="book-suggestions" role="listbox" aria-label="Address suggestions">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.placeId ?? suggestion.label}:${suggestion.latitude}`}>
              <button type="button" role="option" onClick={() => { void selectSuggestion(suggestion); }}>{suggestion.label}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ParcelForm({ draft, onChange }: { draft: BookingDraft; onChange: (patch: Partial<BookingDraft>) => void }) {
  const contents = [
    { label: 'Parcel', description: 'Parcel' as const },
    { label: 'Document', description: 'Document' as const },
    { label: 'Food', description: 'Food' as const },
  ];
  const classes: { value: ServiceClass; label: string }[] = [
    { value: 'FLEXIBLE', label: 'Flexible' },
    { value: 'EXPRESS', label: 'Urgent' },
  ];
  const payments: { value: PaymentMethod; label: string }[] = [
    { value: 'CASH', label: 'Cash' },
    { value: 'ECOCASH', label: 'EcoCash' },
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
                {content.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="field">
        Description (optional)
        <span className="book-hint">Describe what you are sending.</span>
        <textarea
          value={draft.instructions}
          maxLength={INSTRUCTION_LIMIT}
          placeholder="E.g. motor spares, clothes"
          onChange={(event) => onChange({ instructions: event.target.value.slice(0, INSTRUCTION_LIMIT) })}
        />
        <span className="book-counter">{draft.instructions.length}/{INSTRUCTION_LIMIT}</span>
      </label>
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
  return (
    <div className="book-review">
      <div className="book-route">
        <StopSummary stop={draft.pickup} />
        <StopSummary stop={draft.dropoff} />
      </div>
      <dl className="book-facts">
        <div><dt>Sending</dt><dd>{describeParcel(draft)}{draft.instructions.trim() ? ` · ${draft.instructions.trim()}` : ''}</dd></div>
        <div><dt>Delivery type</dt><dd>{draft.serviceClass === 'EXPRESS' ? 'Urgent' : 'Flexible'}</dd></div>
        {draft.paymentMethod ? <div><dt>Method</dt><dd>{paymentMethodLabel(draft.paymentMethod)}</dd></div> : null}
      </dl>
      <div className="book-price">
        {quoting ? <Loading label="Getting price" /> : null}
        {quote && !quoting ? (
          <>
            <div>
              <p>Suggested price</p>
              <strong>{moneyLabel(quote.suggestedPrice)}</strong>
            </div>
            <div>
              <p>Distance</p>
              <strong>{formatDistance(quote.distanceMeters)}</strong>
            </div>
            <label className="field">
              Your offer ($)
              <input inputMode="decimal" maxLength={7} value={offerText} disabled={!editable} placeholder="0.00" onChange={(event) => onOfferChange(event.target.value)} />
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}

function StopSummary({ stop }: { stop: StopDraft }) {
  const phone = displayPhone(stop.contactPhone);
  return (
    <div>
      <p>{deliveryCardAddress(stop.address.trim())}</p>
      {stop.contactName.trim() ? <p>{stop.contactName.trim()}</p> : null}
      {phone ? <p>{deliveryContactPhone(stop.contactPhone) ? phone : stop.contactPhone.trim()}</p> : null}
    </div>
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

