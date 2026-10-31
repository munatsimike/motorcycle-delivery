import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import {
  clearRecentDeliveries,
  loadRecentDeliveries,
  saveRecentDeliveries,
} from '../../data/recentDeliveryStore';
import { appendDeliveries, replaceDeliveries } from '../../domain/customerDeliveryList';
import type { CustomerDelivery, DeliveryStatus } from '../../domain/deliveryStatus';
import { loadCustomerDeliveries } from '../../domain/loadCustomerDeliveries';
import {
  applyDeliveryRefresh,
  commitSyncGeneration,
  deliveryListFailure,
  issueSyncGeneration,
  shouldRefreshDeliveriesOnForeground,
  type SyncClock,
} from '../../domain/recentDeliveryCache';

export function useCustomerDeliveries(accessToken: string | null, customerId: string | null, statuses?: readonly DeliveryStatus[]) {
  const [deliveries, setDeliveries] = useState<CustomerDelivery[]>([]);
  const [boundCustomerId, setBoundCustomerId] = useState(customerId);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showingSaved, setShowingSaved] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const request = useRef(0);
  const clock = useRef<SyncClock>({ issued: 0, committed: 0 });
  const source = useRef<'cache' | 'network' | 'none'>('none');
  const showingSavedRef = useRef(false);
  const focusedRef = useRef(false);
  const statusKey = statuses?.join(',') ?? '';

  if (boundCustomerId !== customerId) {
    setBoundCustomerId(customerId);
    setDeliveries([]);
    setPage(0);
    setTotalPages(0);
    setError(null);
    setShowingSaved(false);
    setSavedAt(null);
    clock.current = { issued: 0, committed: 0 };
    source.current = 'none';
    showingSavedRef.current = false;
  }

  const load = useCallback((nextPage: number) => {
    if (!accessToken) {
      request.current += 1;
      setDeliveries([]);
      setPage(0);
      setTotalPages(0);
      setError('Deliveries are unavailable.');
      setShowingSaved(false);
      setSavedAt(null);
      showingSavedRef.current = false;
      source.current = 'none';
      setIsLoading(false);
      setIsLoadingMore(false);
      return;
    }

    const current = request.current + 1;
    request.current = current;
    if (nextPage === 1) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    const requestedCustomerId = customerId;
    const requested = statusKey.length === 0 ? undefined : statusKey.split(',') as DeliveryStatus[];
    void (async () => {
      let generation = 0;
      if (nextPage === 1 && requestedCustomerId && requested === undefined) {
        try {
          const snapshot = await loadRecentDeliveries(requestedCustomerId);
          if (request.current !== current) {
            return;
          }
          if (snapshot) {
            clock.current = {
              issued: Math.max(clock.current.issued, snapshot.syncGeneration),
              committed: Math.max(clock.current.committed, snapshot.syncGeneration),
            };
            if (source.current !== 'network') {
              source.current = 'cache';
              setDeliveries(snapshot.deliveries);
              setSavedAt(snapshot.savedAt);
            }
          }
        } catch {
          // A storage failure still leaves the network refresh free to run.
        }
        generation = issueSyncGeneration(clock.current);
      }
      try {
        const loaded = await loadCustomerDeliveries(
          customerDeliveryRepository,
          accessToken,
          nextPage,
          requested,
        );
        if (request.current !== current) {
          return;
        }
        if (nextPage === 1 && requestedCustomerId && requested === undefined) {
          if (!commitSyncGeneration(clock.current, generation)) {
            return;
          }
          const savedAtNow = new Date().toISOString();
          const decision = applyDeliveryRefresh(null, {
            customerId: requestedCustomerId,
            deliveries: loaded.deliveries,
            savedAt: savedAtNow,
            syncGeneration: generation,
          });
          if (decision && decision !== 'keep') {
            await saveRecentDeliveries(decision);
            setSavedAt(decision.savedAt);
          } else if (decision === null) {
            await clearRecentDeliveries(requestedCustomerId);
            setSavedAt(null);
          }
        }
        if (request.current !== current) {
          return;
        }
        source.current = 'network';
        showingSavedRef.current = false;
        setShowingSaved(false);
        setError(null);
        setDeliveries((existing) => nextPage === 1
          ? replaceDeliveries(loaded.deliveries)
          : appendDeliveries(existing, loaded.deliveries));
        setPage(loaded.page);
        setTotalPages(loaded.totalPages);
      } catch (caught: unknown) {
        if (request.current !== current) {
          return;
        }
        if (deliveryListFailure(caught) === 'authentication') {
          showingSavedRef.current = false;
          setShowingSaved(false);
          setError(errorMessage(caught, 'Sign in again.'));
          return;
        }
        if (nextPage === 1 && source.current !== 'none') {
          showingSavedRef.current = true;
          setShowingSaved(true);
          setPage(0);
          setTotalPages(0);
          setError(null);
          return;
        }
        if (nextPage === 1) {
          setDeliveries([]);
          setPage(0);
          setTotalPages(0);
          setShowingSaved(false);
          showingSavedRef.current = false;
        }
        setError(errorMessage(caught, 'Deliveries are unavailable.'));
      } finally {
        if (request.current === current) {
          setIsLoading(false);
          setIsLoadingMore(false);
          setIsRefreshing(false);
        }
      }
    })();
  }, [accessToken, customerId, statusKey]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    load(1);
    return () => {
      focusedRef.current = false;
      request.current += 1;
    };
  }, [load]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (shouldRefreshDeliveriesOnForeground(nextState, focusedRef.current)) {
        load(1);
      }
    });
    return () => subscription.remove();
  }, [load]);

  const hasMore = page > 0 && page < totalPages;
  const refresh = useCallback(() => {
    setIsRefreshing(true);
    load(1);
  }, [load]);

  return {
    deliveries,
    isLoading,
    isLoadingMore,
    isRefreshing,
    error,
    showingSaved,
    savedAt,
    hasMore,
    refresh,
    reload: () => load(1),
    loadMore: () => {
      if (!hasMore || isLoading || isLoadingMore) {
        return;
      }
      load(page + 1);
    },
  };
}
