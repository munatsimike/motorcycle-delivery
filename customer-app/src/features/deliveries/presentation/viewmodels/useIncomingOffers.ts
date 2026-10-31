import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { acceptanceKeys, createAcceptanceKey } from '../../data/acceptanceKeyStore';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import {
  bidCanAccept,
  bidsAfterFailure,
  createAcceptanceGate,
  type BidAcceptance,
  type CustomerBid,
} from '../../domain/customerBids';
import type { CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { TRACKING_POLL_MS } from '../../domain/deliveryTracking';
import { deliveryAwaitsRiderOffers, mergeIncomingOffers, offersMissingSince } from '../../domain/riderOffers';
import { acceptCustomerBid } from '../../domain/usecases/acceptCustomerBid';

export function useIncomingOffers(
  accessToken: string | null,
  delivery: CustomerDeliveryDetail | null,
  onAccepted: (acceptance: BidAcceptance, bid: CustomerBid) => void,
) {
  const focused = useIsFocused();
  const [offers, setOffers] = useState<CustomerBid[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unavailableNotice, setUnavailableNotice] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [listen, setListen] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const request = useRef(0);
  const seen = useRef<string[]>([]);
  const gate = useRef(createAcceptanceGate());
  const heldError = useRef<string | null>(null);
  const offersRef = useRef(offers);
  const deliveryRef = useRef(delivery);
  const chosenRef = useRef(false);
  const deliveryId = delivery?.id ?? null;
  const awaiting = deliveryAwaitsRiderOffers(delivery);
  offersRef.current = offers;
  deliveryRef.current = delivery;
  chosenRef.current = chosen;

  useEffect(() => {
    request.current += 1;
    seen.current = [];
    heldError.current = null;
    setOffers([]);
    setError(null);
    setUnavailableNotice(null);
    setChosen(false);
    setLoaded(false);
    setRefreshing(false);
    setListen(true);
  }, [deliveryId]);

  useEffect(() => {
    if (!awaiting) {
      setChosen(false);
    }
  }, [awaiting]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const load = useCallback(async () => {
    if (!accessToken || !deliveryId || !awaiting || chosenRef.current) {
      return;
    }
    const current = request.current + 1;
    request.current = current;
    try {
      const next = await customerDeliveryRepository.listBids(accessToken, deliveryId);
      if (request.current !== current) {
        return;
      }
      const open = next.filter((bid) => bid.deliveryId === deliveryId && bid.status === 'OPEN');
      const openIds = open.map((bid) => bid.id);
      if (offersMissingSince(seen.current, openIds)) {
        setUnavailableNotice('An offer is no longer available.');
      }
      seen.current = openIds;
      setOffers((currentOffers) => mergeIncomingOffers(currentOffers, open));
      setError(heldError.current);
      setLoaded(true);
    } catch (caught: unknown) {
      if (request.current !== current) {
        return;
      }
      const message = errorMessage(caught, 'Bids are unavailable.');
      if (/bidding is not available/i.test(message)) {
        setListen(false);
        heldError.current = null;
        setError(null);
        setLoaded(true);
        return;
      }
      setOffers((currentOffers) => bidsAfterFailure(currentOffers));
      setError(message);
      setLoaded(true);
    }
  }, [accessToken, awaiting, deliveryId]);

  useEffect(() => {
    if (!focused || !appActive || !awaiting || !listen || chosen) {
      return;
    }
    void load();
    const timer = setInterval(() => {
      void load();
    }, TRACKING_POLL_MS);
    return () => clearInterval(timer);
  }, [appActive, awaiting, chosen, focused, listen, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const choose = useCallback(async (bid: CustomerBid) => {
    const currentDelivery = deliveryRef.current;
    const currentOffer = offersRef.current.find((item) => item.id === bid.id);
    if (!currentDelivery || !currentOffer || !bidCanAccept(currentOffer) || !deliveryAwaitsRiderOffers(currentDelivery)) {
      heldError.current = 'This offer is no longer available.';
      setError(heldError.current);
      return;
    }
    if (!gate.current.begin()) {
      return;
    }
    setAcceptingId(currentOffer.id);
    heldError.current = null;
    setError(null);
    try {
      const accepted = await acceptCustomerBid(
        customerDeliveryRepository,
        acceptanceKeys,
        accessToken,
        currentDelivery.id,
        currentOffer.id,
        createAcceptanceKey,
      );
      setChosen(true);
      onAccepted(accepted, currentOffer);
    } catch (caught: unknown) {
      const message = errorMessage(caught, 'This bid could not be accepted.');
      heldError.current = message;
      setError(message);
      void load();
    } finally {
      gate.current.end();
      setAcceptingId(null);
    }
  }, [accessToken, load, onAccepted]);

  return {
    offers,
    error,
    unavailableNotice,
    acceptingId,
    chosen,
    loaded,
    refreshing,
    refresh,
    choose,
  };
}
