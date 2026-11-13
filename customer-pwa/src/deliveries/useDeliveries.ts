import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../auth/sessionContext';
import { deliveryErrorMessage, deliveryFailure, listDeliveries } from './api';
import {
  ACTIVE_LIST_STATUSES,
  appendDeliveries,
  isKnownDeliveryStatus,
  replaceDeliveries,
  savedDeliveryMessage,
  type CustomerDelivery,
  type DeliveryStatus,
} from './rules';

const CACHE_KEY = 'riders.customer.deliveries.active';

export function useDeliveries(statuses: readonly DeliveryStatus[]) {
  const { accessToken } = useSession();
  const [deliveries, setDeliveries] = useState<CustomerDelivery[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const request = useRef(0);
  const statusKey = statuses.join(',');
  const caches = sameStatuses(statuses, ACTIVE_LIST_STATUSES);

  const load = useCallback((nextPage: number, refresh = false) => {
    const current = request.current + 1;
    request.current = current;
    if (refresh) setIsRefreshing(true);
    else if (nextPage === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    const requested = statusKey.split(',') as DeliveryStatus[];
    void (async () => {
      const token = await accessToken();
      if (request.current !== current) return;
      if (!token) {
        setDeliveries([]);
        setError('Deliveries are unavailable.');
        setOfflineNote(null);
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        return;
      }
      if (nextPage === 1 && caches) {
        const saved = readActiveCache();
        if (saved) {
          setDeliveries(saved.deliveries);
          setOfflineNote(null);
        }
      }
      try {
        const loaded = await listDeliveries(token, nextPage, requested);
        if (request.current !== current) return;
        if (nextPage === 1 && caches) writeActiveCache(loaded.deliveries);
        setOfflineNote(null);
        setError(null);
        setDeliveries((existing) => nextPage === 1 ? replaceDeliveries(loaded.deliveries) : appendDeliveries(existing, loaded.deliveries));
        setPage(loaded.page);
        setTotalPages(loaded.totalPages);
      } catch (caught) {
        if (request.current !== current) return;
        if (deliveryFailure(caught) === 'authentication') {
          setOfflineNote(null);
          setError(deliveryErrorMessage(caught, 'Sign in again.'));
          return;
        }
        if (nextPage === 1 && caches) {
          const saved = readActiveCache();
          if (saved && saved.deliveries.length > 0) {
            setDeliveries(saved.deliveries);
            setOfflineNote(savedDeliveryMessage(saved.savedAt));
            setError(null);
            setPage(0);
            setTotalPages(0);
            return;
          }
        }
        if (nextPage === 1) {
          setDeliveries([]);
          setPage(0);
          setTotalPages(0);
        }
        setError(deliveryErrorMessage(caught, 'Deliveries are unavailable.'));
      } finally {
        if (request.current === current) {
          setIsLoading(false);
          setIsLoadingMore(false);
          setIsRefreshing(false);
        }
      }
    })();
  }, [accessToken, caches, statusKey]);

  useEffect(() => {
    load(1);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      request.current += 1;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const hasMore = page > 0 && page < totalPages;
  return {
    deliveries,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    offlineNote,
    hasMore,
    refresh: () => load(1, true),
    reload: () => load(1),
    loadMore: () => {
      if (!hasMore || isLoading || isLoadingMore) return;
      load(page + 1);
    },
  };
}

function sameStatuses(left: readonly DeliveryStatus[], right: readonly DeliveryStatus[]): boolean {
  return left.length === right.length && left.every((status, index) => status === right[index]);
}

function readActiveCache(): { savedAt: string; deliveries: CustomerDelivery[] } | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { savedAt?: unknown; deliveries?: unknown };
    if (typeof value.savedAt !== 'string' || !Array.isArray(value.deliveries)) return null;
    const deliveries = value.deliveries.filter(isCachedDelivery);
    if (deliveries.length === 0) return null;
    return { savedAt: value.savedAt, deliveries };
  } catch {
    return null;
  }
}

function isCachedDelivery(value: unknown): value is CustomerDelivery {
  if (!value || typeof value !== 'object') return false;
  const delivery = value as CustomerDelivery;
  return typeof delivery.id === 'string'
    && typeof delivery.status === 'string'
    && isKnownDeliveryStatus(delivery.status)
    && typeof delivery.pickupAddress === 'string'
    && typeof delivery.dropoffAddress === 'string';
}

function writeActiveCache(deliveries: CustomerDelivery[]) {
  try {
    if (deliveries.length === 0) {
      sessionStorage.removeItem(CACHE_KEY);
      return;
    }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), deliveries: deliveries.slice(0, 5) }));
  } catch {
    // Storage can be unavailable. The network list still renders.
  }
}
