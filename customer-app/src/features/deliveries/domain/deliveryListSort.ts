import type { CustomerDelivery } from './deliveryStatus';

export type DeliveryListSort = 'newest' | 'oldest' | 'shortest' | 'longest' | 'highest' | 'lowest';

const SORT_RULE: Record<DeliveryListSort, { field: 'date' | 'distance' | 'price'; direction: 'asc' | 'desc' }> = {
  newest: { field: 'date', direction: 'desc' },
  oldest: { field: 'date', direction: 'asc' },
  shortest: { field: 'distance', direction: 'asc' },
  longest: { field: 'distance', direction: 'desc' },
  highest: { field: 'price', direction: 'desc' },
  lowest: { field: 'price', direction: 'asc' },
};

export function sortDeliveries(deliveries: readonly CustomerDelivery[], sort: DeliveryListSort): CustomerDelivery[] {
  return [...deliveries].sort((left, right) => compareDeliveries(left, right, sort));
}

function compareDeliveries(left: CustomerDelivery, right: CustomerDelivery, sort: DeliveryListSort): number {
  const rule = SORT_RULE[sort];
  const primary = rule.field === 'distance'
    ? compareMissingLast(left.distanceMeters ?? null, right.distanceMeters ?? null, rule.direction)
    : rule.field === 'price'
      ? compareMissingLast(deliveryPrice(left), deliveryPrice(right), rule.direction)
      : compareMissingLast(deliveryTime(left.createdAt), deliveryTime(right.createdAt), rule.direction);
  if (primary !== 0) {
    return primary;
  }
  const date = compareMissingLast(deliveryTime(left.createdAt), deliveryTime(right.createdAt), 'desc');
  if (date !== 0) {
    return date;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function deliveryPrice(delivery: CustomerDelivery): number | null {
  return money(delivery.offeredPrice) ?? money(delivery.suggestedPrice);
}

function money(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,10}\.\d{2}$/.test(value)) {
    return null;
  }
  return Number(value);
}

function deliveryTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareMissingLast(left: number | null, right: number | null, direction: 'asc' | 'desc'): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return direction === 'asc' ? left - right : right - left;
}
