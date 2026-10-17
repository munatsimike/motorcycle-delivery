import { useRef, useState } from 'react';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import {
  emptyBookingDraft,
  parcelError,
  prepareBooking,
  stopDetailsError,
  stopError,
  type BookingDraft,
  type PreparedBooking,
  type StopDraft,
} from '../../domain/bookingDraft';
import type { PickupPin } from '../../domain/pickupLocation';
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
  const creating = useRef(false);
  const quoteRequest = useRef(0);

  function updateStop(which: 'pickup' | 'dropoff', patch: Partial<StopDraft>) {
    setError(null);
    if (patch.latitude !== undefined || patch.longitude !== undefined) {
      quoteRequest.current += 1;
      setQuote(null);
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

  async function goNext(
    locatePickup?: (address: string) => Promise<PickupPin>,
    locateDropoff?: (address: string) => Promise<PickupPin>,
  ) {
    if (busy) {
      return;
    }
    if (step === 'pickup') {
      const details = stopDetailsError(draft.pickup, 'pickup');
      if (details) {
        setError(details);
        return;
      }
      if (!locatePickup) {
        setError('Enter a valid pickup location');
        return;
      }
      const address = draft.pickup.address;
      setBusy('locate');
      setError(null);
      try {
        const pin = await locatePickup(address);
        if (!pin.ok) {
          setError(pin.error);
          return;
        }
        setDraft((current) => ({
          ...current,
          pickup: {
            ...current.pickup,
            latitude: pin.latitude,
            longitude: pin.longitude,
          },
        }));
        setStep('destination');
      } catch {
        setError('This address could not be found. Enter a more specific address.');
      } finally {
        setBusy(null);
      }
      return;
    }
    if (step === 'destination') {
      const details = stopDetailsError(draft.dropoff, 'drop-off');
      if (details) {
        setError(details);
        return;
      }
      if (!locateDropoff) {
        setError('Enter a valid drop-off location');
        return;
      }
      const address = draft.dropoff.address;
      setBusy('locate');
      setError(null);
      try {
        const pin = await locateDropoff(address);
        if (!pin.ok) {
          setError(pin.error);
          return;
        }
        setDraft((current) => ({
          ...current,
          dropoff: {
            ...current.dropoff,
            latitude: pin.latitude,
            longitude: pin.longitude,
          },
        }));
        setStep('parcel');
      } catch {
        setError('This address could not be found. Enter a more specific address.');
      } finally {
        setBusy(null);
      }
      return;
    }
    let pricingDraft = draft;
    if (step === 'parcel' && locatePickup && locateDropoff) {
      setBusy('locate');
      setError(null);
      try {
        const pickupPin = await locatePickup(draft.pickup.address);
        if (!pickupPin.ok) {
          setError(pickupPin.error);
          return;
        }
        const dropoffPin = await locateDropoff(draft.dropoff.address);
        if (!dropoffPin.ok) {
          setError(dropoffPin.error);
          return;
        }
        pricingDraft = {
          ...draft,
          pickup: {
            ...draft.pickup,
            latitude: pickupPin.latitude,
            longitude: pickupPin.longitude,
          },
          dropoff: {
            ...draft.dropoff,
            latitude: dropoffPin.latitude,
            longitude: dropoffPin.longitude,
          },
        };
        setDraft(pricingDraft);
      } catch {
        setError('This address could not be found. Enter a more specific address.');
        return;
      } finally {
        setBusy(null);
      }
    }
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
    updateStop,
    updateDraft,
    prefillPickup,
    goBack,
    goNext,
    confirm,
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
