import { useRef, useState } from 'react';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import {
  emptyBookingDraft,
  parcelError,
  prepareBooking,
  stopError,
  type BookingDraft,
  type PreparedBooking,
  type StopDraft,
} from '../../domain/bookingDraft';
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
  const [busy, setBusy] = useState<'quote' | 'create' | null>(null);
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

  async function goNext() {
    if (busy) {
      return;
    }
    const validation = validateStep(step, draft);
    if (validation) {
      setError(validation);
      return;
    }
    const prepared = prepareBooking(draft);
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
