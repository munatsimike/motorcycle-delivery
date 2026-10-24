import type { ServiceClass } from './bookingDraft';

export type OpenBidRequest = {
  id: string;
  status: 'CREATED';
  serviceClass: ServiceClass;
  deliverBy: string;
  suggestedPrice: string;
  currency: 'USD';
};

export const OPEN_FOR_BIDS = 'Open for rider bids';

export function readOpenBidRequest(value: unknown): OpenBidRequest {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Delivery details are unavailable.');
  }
  if (value.status !== 'CREATED') {
    throw new Error('Delivery details are unavailable.');
  }
  if (value.serviceClass !== 'EXPRESS' && value.serviceClass !== 'FLEXIBLE') {
    throw new Error('Delivery details are unavailable.');
  }
  if (typeof value.deliverBy !== 'string' || Number.isNaN(new Date(value.deliverBy).getTime())) {
    throw new Error('Delivery details are unavailable.');
  }
  if (value.currency !== 'USD' || typeof value.suggestedPrice !== 'string' || !/^\d{1,10}\.\d{2}$/.test(value.suggestedPrice)) {
    throw new Error('Delivery details are unavailable.');
  }
  if (value.offeredPrice !== undefined && value.offeredPrice !== null) {
    throw new Error('Delivery details are unavailable.');
  }
  if (value.searchGeneration !== undefined && value.searchGeneration !== 0) {
    throw new Error('Delivery details are unavailable.');
  }
  return {
    id: value.id,
    status: 'CREATED',
    serviceClass: value.serviceClass,
    deliverBy: value.deliverBy,
    suggestedPrice: value.suggestedPrice,
    currency: 'USD',
  };
}

export function openBidConfirmation(request: OpenBidRequest): string {
  return request.status === 'CREATED' ? OPEN_FOR_BIDS : '';
}

export function startsRiderSearch(): boolean {
  return false;
}

export function waitsForRiderConfirmation(): boolean {
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
