import { useRef, useState } from 'react';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { expoAddressGeocoder, expoDeviceAddressAccess } from '../../data/expoAddressGeocoder';
import { resolveManualAddress, typedHouseNumber, type ResolvedLocation } from '../../domain/addressResolution';
import {
  emptyBookingDraft,
  parcelError,
  prepareBooking,
  stopEntryError,
  stopError,
  type BookingDraft,
  type PreparedBooking,
  type StopDraft,
} from '../../domain/bookingDraft';
import { readDeviceAddressPin } from '../../domain/deviceAddress';
import type { PlaceSuggestion } from '../../domain/placeSuggestion';
import { quotesMatch, type DeliveryQuote } from '../../domain/deliveryQuote';
import { createDelivery } from '../../domain/usecases/createDelivery';
import { quoteDelivery } from '../../domain/usecases/quoteDelivery';

export const BOOKING_STEPS = ['pickup', 'destination', 'parcel', 'review', 'confirm'] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];

type QuotedPrice = DeliveryQuote & {
  pinKey: string;
};

export function useParcelBooking(accessToken: string | null) {
  const [draft, setDraft] = useState<BookingDraft>(emptyBookingDraft);
  const [step, setStep] = useState<BookingStep>('pickup');
  const [quote, setQuote] = useState<QuotedPrice | null>(null);
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
      setAreaChoices([]);
    }
    setDraft((current) => ({
      ...current,
      [which]: { ...current[which], ...patch },
    }));
  }

  function updateDraft(patch: Partial<BookingDraft>) {
    setError(null);
    setDraft((current) => ({ ...current, ...patch }));
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
          let suggestions: PlaceSuggestion[] = [];
          let lookupError: string | null = null;
          try {
            suggestions = await customerDeliveryRepository.searchPlaces(accessToken, typed);
          } catch (caught: unknown) {
            lookupError = errorMessage(caught, 'Address suggestions are unavailable. You can type the address.');
          }
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
    const validation = validateStep(step, pricingDraft);
    if (validation) {
      setError(validation);
      return;
    }
    const prepared = prepareBooking(pricingDraft);
    if (step === 'parcel' || step === 'review') {
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      if (step === 'parcel' && (!quote || quote.pinKey !== prepared.booking.pinKey)) {
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

  async function confirm(onCreated: (deliveryId: string) => void) {
    if (creating.current || busy) {
      return;
    }
    const prepared = prepareBooking(draft);
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    if (!quote || quote.pinKey !== prepared.booking.pinKey) {
      setError('Request a price before confirming.');
      return;
    }
    creating.current = true;
    setBusy('create');
    setError(null);
    try {
      const fresh = await quoteDelivery(customerDeliveryRepository, accessToken, prepared.booking);
      if (!quotesMatch(quote, fresh)) {
        setQuote({ ...fresh, pinKey: prepared.booking.pinKey });
        setError('The price changed. Review the new price and confirm again.');
        return;
      }
      const created = await createDelivery(
        customerDeliveryRepository,
        accessToken,
        prepared.booking,
        fresh.suggestedPrice,
      );
      onCreated(created.id);
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
      if (quoteRequest.current !== request) {
        return false;
      }
      setQuote({ ...next, pinKey: booking.pinKey });
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

  return {
    draft,
    step,
    quote,
    error,
    busy,
    areaChoices,
    updateStop,
    updateDraft,
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
  };
}

function validateStep(step: BookingStep, draft: BookingDraft): string | null {
  if (step === 'pickup') {
    return stopError(draft.pickup, 'pickup');
  }
  if (step === 'destination') {
    return stopError(draft.dropoff, 'drop-off');
  }
  if (step === 'parcel') {
    return parcelError(draft);
  }
  return null;
}
