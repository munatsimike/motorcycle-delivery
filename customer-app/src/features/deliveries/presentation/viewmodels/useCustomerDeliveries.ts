import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { appendDeliveries, replaceDeliveries } from '../../domain/customerDeliveryList';
import type { CustomerDelivery, DeliveryStatus } from '../../domain/deliveryStatus';
import { loadCustomerDeliveries } from '../../domain/loadCustomerDeliveries';

export function useCustomerDeliveries(accessToken: string | null, statuses?: readonly DeliveryStatus[]) {
  const [deliveries, setDeliveries] = useState<CustomerDelivery[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const statusKey = statuses?.join(',') ?? '';

  const load = useCallback((nextPage: number) => {
    if (!accessToken) {
      request.current += 1;
      setDeliveries([]);
      setPage(0);
      setTotalPages(0);
      setError('Deliveries are unavailable.');
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
    setError(null);
    const requested = statusKey.length === 0 ? undefined : statusKey.split(',') as DeliveryStatus[];
    loadCustomerDeliveries(customerDeliveryRepository, accessToken, nextPage, requested)
      .then((loaded) => {
        if (request.current !== current) {
          return;
        }
        setDeliveries((existing) => nextPage === 1
          ? replaceDeliveries(loaded.deliveries)
          : appendDeliveries(existing, loaded.deliveries));
        setPage(loaded.page);
        setTotalPages(loaded.totalPages);
      })
      .catch((caught: unknown) => {
        if (request.current !== current) {
          return;
        }
        if (nextPage === 1) {
          setDeliveries([]);
          setPage(0);
          setTotalPages(0);
        }
        setError(errorMessage(caught, 'Deliveries are unavailable.'));
      })
      .finally(() => {
        if (request.current === current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      });
  }, [accessToken, statusKey]);

  useFocusEffect(useCallback(() => {
    load(1);
    return () => {
      request.current += 1;
    };
  }, [load]));

  const hasMore = page > 0 && page < totalPages;

  return {
    deliveries,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    reload: () => load(1),
    loadMore: () => {
      if (!hasMore || isLoading || isLoadingMore) {
        return;
      }
      load(page + 1);
    },
  };
}
