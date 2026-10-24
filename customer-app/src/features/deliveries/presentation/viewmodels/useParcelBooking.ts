import { useRef, useState } from 'react';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { createPlaceSessionToken } from '../../domain/placeSession';
import { expoAddressGeocoder, expoDeviceAddressAccess } from '../../data/expoAddressGeocoder';
import { resolveManualAddress, typedHouseNumber, type ResolvedLocation } from '../../domain/addressResolution';
import {
  emptyBookingDraft,
  parcelError,
  prepareBooking,
  quoteIdentity,
  stopEntryError,
  stopError,
  withBookingPatch,
  type BookingDraft,
  type PreparedBooking,
  type StopDraft,
} from '../../domain/bookingDraft';
import type { OpenBidRequest } from '../../domain/openBidRequest';
import { readDeviceAddressPin } from '../../domain/deviceAddress';
import { selectedAddressLabel, type PlaceSuggestion } from '../../domain/placeSuggestion';
import {
  customerOfferForBooking,
  nextCustomerOffer,
  offerFieldText,
  quoteResultForRequest,
  quotesMatch,
  type DeliveryQuote,
} from '../../domain/deliveryQuote';
import { createDelivery } from '../../domain/usecases/createDelivery';
import { createOpenRequest } from '../../domain/usecases/createOpenRequest';
import { quoteDelivery } from '../../domain/usecases/quoteDelivery';
import { selectedPlaceBias } from './usePlaceBias';

export const BOOKING_STEPS = ['pickup', 'destination', 'parcel', 'review', 'confirm'] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];

type QuotedPrice = DeliveryQuote & {
  pinKey: string;
};

type CustomerOffer = {
  text: string;
  edited: boolean;
  pinKey: string | null;
};

export type BookingResult =
  | { mode: 'v1'; deliveryId: string }
  | { mode: 'v2'; request: OpenBidRequest };

export function useParcelBooking(accessToken: string | null, marketplace = false) {
  const [draft, setDraft] = useState<BookingDraft>(emptyBookingDraft);
  const [step, setStep] = useState<BookingStep>('pickup');
  const [quote, setQuote] = useState<QuotedPrice | null>(null);
  const [offer, setOffer] = useState<CustomerOffer>({ text: '', edited: false, pinKey: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'quote' | 'create' | 'locate' | null>(null);
  const [areaChoices, setAreaChoices] = useState<PlaceSuggestion[]>([]);
  const creating = useRef(false);
  const quoteRequest = useRef(0);

  function updateStop(which: 'pickup' | 'dropoff', patch: Partial<StopDraft>) {
    setError(null);
    if (patch.latitude !== undefined || patch.longitude !== undefined || patch.address !== undefined) {
      quoteRequest.current += 1;
      setQuote(null);
      setOffer({ text: '', edited: false, pinKey: null });
      setAreaChoices([]);
    }
    setDraft((current) => ({
      ...current,
      [which]: { ...current[which], ...patch },
    }));
  }

  function updateDraft(patch: Partial<BookingDraft>) {
    setError(null);
    if (patch.serviceClass !== undefined) {
      quoteRequest.current += 1;
      setQuote(null);
    }
    setDraft((current) => withBookingPatch(current, patch));
  }

  function prefillPickup(details: { contactName: string; contactPhone: string; address: string }) {
    setDraft((current) => {
      const contactName = current.pickup.contactName || details.contactName;
      const contactPhone = current.pickup.contactPhone || details.contactPhone;
      const address = current.pickup.address || details.address;
      if (
        contactName === current.pickup.contactName &&
        contactPhone === current.pickup.contactPhone &&
        address === current.pickup.address
      ) {
        return current;
      }
      return {
        ...current,
        pickup: {
          ...current.pickup,
          contactName,
          contactPhone,
          address,
        },
      };
    });
  }

  function goBack() {
    if (busy) {
      return;
    }
    setError(null);
    setStep((current) => {
      const index = BOOKING_STEPS.indexOf(current);
      return BOOKING_STEPS[Math.max(0, index - 1)] ?? 'pickup';
    });
  }

  async function goNext() {
    if (busy) {
      return;
    }
    if (step === 'pickup' || step === 'destination') {
      const which = step === 'pickup' ? 'pickup' : 'dropoff';
      const stop = draft[which];
      const label = step === 'pickup' ? 'pickup' : 'drop-off';
      const details = stopEntryError(stop, label);
      if (details) {
        setError(details);
        return;
      }
      let located = stop;
      if (!stop.latitude.trim() || !stop.longitude.trim()) {
        if (stop.address.trim().length < 3 || !accessToken) {
          setError(`Choose the ${label} address`);
          return;
        }
        setBusy('locate');
        setError(null);
        setAreaChoices([]);
        try {
          const typed = stop.address.trim();
          const sessionToken = createPlaceSessionToken();
          let suggestions: PlaceSuggestion[] = [];
          let lookupError: string | null = null;
          try {
            const bias = which === 'dropoff'
              ? selectedPlaceBias(draft.pickup.latitude, draft.pickup.longitude)
              : null;
            suggestions = (await customerDeliveryRepository.searchPlaces(accessToken, typed, bias, sessionToken))
              .map((suggestion) => ({ ...suggestion, sessionToken }));
            const exact = suggestions.find((suggestion) => suggestion.exact && suggestion.placeId && !suggestion.latitude);
            if (exact?.placeId) {
              const resolved = await customerDeliveryRepository.resolvePlace(accessToken, exact.placeId, sessionToken);
              suggestions = suggestions.map((suggestion) => suggestion.placeId === exact.placeId
                ? {
                  ...suggestion,
                  label: selectedAddressLabel(suggestion.label, resolved),
                  latitude: resolved.latitude,
                  longitude: resolved.longitude,
                }
                : suggestion);
            }
          } catch (caught: unknown) {
            lookupError = errorMessage(caught, 'Address suggestions are unavailable. You can type the address.');
          }
          suggestions = suggestions.filter((suggestion) => suggestion.latitude.trim() || !suggestion.exact);
          let devicePoint: { latitude: string; longitude: string } | null = null;
          let deviceMessage: string | null = null;
          if (!suggestions.some((suggestion) => suggestion.exact)) {
            const device = await readDeviceAddressPin(typed, expoDeviceAddressAccess, expoAddressGeocoder);
            if (device.status === 'found') {
              devicePoint = device;
            } else if (device.status === 'unavailable') {
              deviceMessage = device.message;
            }
          }
          const resolution = resolveManualAddress(typed, suggestions, devicePoint);
          if (resolution.status === 'resolved' || resolution.status === 'confirm-pin') {
            located = applyResolvedLocation(stop, resolution.location);
            setDraft((current) => ({ ...current, [which]: located }));
          } else if (resolution.status === 'choose-area') {
            setAreaChoices(resolution.areas);
            setError(deviceMessage
              ? `${deviceMessage} You can also choose a nearby area.`
              : 'This street was not found. Choose a nearby area.');
            return;
          } else if (lookupError) {
            setError(lookupError);
            return;
          } else if (deviceMessage) {
            setError(deviceMessage);
            return;
          } else {
            setError('This address could not be found. Choose a nearby area.');
            return;
          }
        } finally {
          setBusy(null);
        }
      }
      setError(null);
      setStep(step === 'pickup' ? 'destination' : 'parcel');
      return;
    }
    const pricingDraft = draft;
    const validation = validateStep(step, pricingDraft, marketplace);
    if (validation) {
      setError(validation);
      return;
    }
    const prepared = prepareBooking(pricingDraft, { marketplace });
    if (step === 'parcel' || step === 'review') {
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      const identity = quoteIdentity(prepared.booking.pinKey, prepared.booking.serviceClass);
      if (step === 'parcel' && (!quote || quote.pinKey !== identity)) {
        const loaded = await loadQuote(prepared.booking);
        if (!loaded) {
          return;
        }
      }
    }
    setError(null);
    setStep((current) => {
      const index = BOOKING_STEPS.indexOf(current);
      return BOOKING_STEPS[Math.min(BOOKING_STEPS.length - 1, index + 1)] ?? current;
    });
  }

  async function confirm(onCreated: (result: BookingResult) => void) {
    if (creating.current || busy) {
      return;
    }
    const prepared = prepareBooking(draft, { marketplace });
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    const identity = quoteIdentity(prepared.booking.pinKey, prepared.booking.serviceClass);
    if (!quote || quote.pinKey !== identity) {
      setError('Request a price before confirming.');
      return;
    }
    const submission = marketplace ? null : customerOfferForBooking(offer.text);
    if (submission && !('offeredPrice' in submission)) {
      setError(submission.error);
      return;
    }
    creating.current = true;
    setBusy('create');
    setError(null);
    try {
      const fresh = await quoteDelivery(customerDeliveryRepository, accessToken, prepared.booking);
      const classChanged = prepared.booking.serviceClass !== null && fresh.serviceClass !== prepared.booking.serviceClass;
      if (!quotesMatch(quote, fresh) || classChanged) {
        rememberQuote({ ...fresh, pinKey: identity });
        setError('The price changed. Review the new price and confirm again.');
        return;
      }
      if (marketplace) {
        const created = await createOpenRequest(customerDeliveryRepository, accessToken, prepared.booking);
        onCreated({ mode: 'v2', request: created });
        return;
      }
      if (!submission || !('offeredPrice' in submission)) {
        setError('Enter an offer from $0.01 to $1,000.00.');
        return;
      }
      const created = await createDelivery(
        customerDeliveryRepository,
        accessToken,
        prepared.booking,
        submission.offeredPrice,
      );
      onCreated({ mode: 'v1', deliveryId: created.id });
    } catch (caught: unknown) {
      setError(errorMessage(caught, 'The delivery could not be booked.'));
    } finally {
      creating.current = false;
      setBusy(null);
    }
  }

  async function loadQuote(booking: PreparedBooking) {
    const request = quoteRequest.current + 1;
    quoteRequest.current = request;
    setBusy('quote');
    setError(null);
    try {
      const next = await quoteDelivery(customerDeliveryRepository, accessToken, booking);
      const current = quoteResultForRequest(request, quoteRequest.current, next);
      if (!current) {
        return false;
      }
      rememberQuote({ ...current, pinKey: quoteIdentity(booking.pinKey, booking.serviceClass) });
      return true;
    } catch (caught: unknown) {
      if (quoteRequest.current === request) {
        setQuote(null);
        setError(errorMessage(caught, 'A price could not be quoted.'));
      }
      return false;
    } finally {
      if (quoteRequest.current === request) {
        setBusy(null);
      }
    }
  }

  function rememberQuote(next: QuotedPrice) {
    setQuote(next);
    setOffer((current) => nextCustomerOffer({
      current: current.text,
      edited: current.edited,
      previousPinKey: current.pinKey,
      pinKey: next.pinKey,
      suggestedPrice: next.suggestedPrice,
    }));
  }

  function updateOffer(value: string) {
    setError(null);
    setOffer((current) => ({
      text: offerFieldText(value),
      edited: true,
      pinKey: current.pinKey,
    }));
  }

  return {
    draft,
    step,
    quote,
    offerText: offer.text,
    error,
    busy,
    areaChoices,
    updateStop,
    updateDraft,
    updateOffer,
    prefillPickup,
    goBack,
    goNext,
    confirm,
  };
}

function applyResolvedLocation(stop: StopDraft, location: ResolvedLocation): StopDraft {
  return {
    ...stop,
    address: location.label,
    landmark: location.precision === 'exact' ? stop.landmark : typedHouseNumber(stop.address, location.precision),
    latitude: location.latitude,
    longitude: location.longitude,
    approximate: location.precision !== 'exact',
    precision: location.precision,
    placeId: location.placeId,
    coordinateSource: location.provider === 'google_places' ? 'GOOGLE_PLACES' : 'DEVICE_GEOCODER',
  };
}

function validateStep(step: BookingStep, draft: BookingDraft, marketplace: boolean): string | null {
  if (step === 'pickup') {
    return stopError(draft.pickup, 'pickup');
  }
  if (step === 'destination') {
    return stopError(draft.dropoff, 'drop-off');
  }
  if (step === 'parcel') {
    return parcelError(draft, marketplace);
  }
  return null;
}
