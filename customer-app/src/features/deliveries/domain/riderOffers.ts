import type { CustomerBid } from './customerBids';
import { deliveryContentKind } from './deliveryCard';

export type OfferSort = 'price' | 'price-high' | 'rides-low' | 'rides-high';

export function showsRiderOffers(delivery: {
  status: string;
  serviceClass: string | null;
  deliverBy?: string | null;
}): boolean {
  return delivery.status === 'CREATED'
    && (delivery.serviceClass === 'FLEXIBLE' || delivery.serviceClass === 'EXPRESS');
}

export function deliveryAwaitsRiderOffers(delivery: {
  status: string;
  serviceClass: string | null;
  deliverBy?: string | null;
} | null): boolean {
  if (!delivery) {
    return false;
  }
  return showsRiderOffers(delivery);
}

export function receivedOfferCountLabel(count: number): string {
  return count === 1 ? '1 offer' : `${count} offers`;
}

const NO_DISMISSED_OFFERS: ReadonlySet<string> = new Set();

export function mergeIncomingOffers(
  previous: readonly CustomerBid[],
  incoming: readonly CustomerBid[],
  dismissedIds: ReadonlySet<string> = NO_DISMISSED_OFFERS,
): CustomerBid[] {
  const open = new Map<string, CustomerBid>();
  for (const bid of incoming) {
    if (bid.status === 'OPEN' && !open.has(bid.id) && !dismissedIds.has(bid.id)) {
      open.set(bid.id, bid);
    }
  }
  const seen = new Set<string>();
  const kept: CustomerBid[] = [];
  for (const bid of previous) {
    const latest = open.get(bid.id);
    if (!latest || seen.has(latest.id)) {
      continue;
    }
    kept.push(latest);
    seen.add(latest.id);
  }
  const added: CustomerBid[] = [];
  for (const bid of open.values()) {
    if (seen.has(bid.id)) {
      continue;
    }
    added.push(bid);
    seen.add(bid.id);
  }
  return [...kept, ...added];
}

export function sortRiderOffers(bids: readonly CustomerBid[], sort: OfferSort): CustomerBid[] {
  return [...bids].sort((left, right) => {
    const price = comparePrice(left, right);
    const rides = left.completedDeliveries - right.completedDeliveries;
    const primary = sort === 'rides-low' ? rides : sort === 'rides-high' ? -rides : sort === 'price-high' ? -price : price;
    const secondary = sort === 'price' || sort === 'price-high' ? rides : price;
    return primary || secondary || left.id.localeCompare(right.id);
  });
}

export function offerCountLabel(count: number, serviceClass?: string | null): string {
  if (serviceClass === 'EXPRESS') {
    return count === 1 ? '1 rider is interested' : `${count} riders are interested`;
  }
  if (count === 1) {
    return '1 rider has made an offer';
  }
  return `${count} riders have made offers`;
}

export function parcelTypeLabel(description: string): string {
  const kind = deliveryContentKind(description);
  if (kind === 'food') {
    return 'Food';
  }
  if (kind === 'document') {
    return 'Document';
  }
  const trimmed = description.trim();
  if (!trimmed || trimmed.toLowerCase() === 'parcel' || trimmed.toLowerCase() === 'parcels') {
    return 'Parcel';
  }
  return trimmed;
}

export function riderProfileFacts(bid: CustomerBid): string[] {
  const facts: string[] = [];
  if (bid.motorcycle) {
    facts.push(`Verified motorcycle: ${bid.motorcycle}`);
  }
  if (bid.ratingCount > 0 && bid.averageRating != null) {
    facts.push(`${bid.averageRating.toFixed(1)} stars`);
  }
  facts.push(tripCountLabel(bid.completedDeliveries));
  const distance = proximityLabel(bid.distanceMeters);
  if (distance) {
    facts.push(distance);
  }
  return facts;
}

export function proximityLabel(meters: number | null): string | null {
  if (meters == null) {
    return null;
  }
  if (meters < 1000) {
    return `${meters} m from pickup`;
  }
  const kilometres = meters / 1000;
  const text = kilometres < 10 ? kilometres.toFixed(1) : String(Math.round(kilometres));
  return `${text} km from pickup`;
}

const CITY_METRES_PER_MINUTE = 25_000 / 60;

export function customerDistanceLabel(meters: number | null): string | null {
  if (meters == null) {
    return null;
  }
  if (meters < 1000) {
    return `${meters} m from you`;
  }
  const kilometres = meters / 1000;
  const text = kilometres < 10 ? kilometres.toFixed(1) : String(Math.round(kilometres));
  return `${text} km from you`;
}

export function arrivalTimeLabel(meters: number | null): string | null {
  if (meters == null) {
    return null;
  }
  const minutes = Math.max(1, Math.round(meters / CITY_METRES_PER_MINUTE));
  return minutes === 1 ? 'about 1 min' : `about ${minutes} min`;
}

export function pickupEtaLabel(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return 'ETA unavailable';
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? '1 min' : `${minutes} min`;
}

export function tripCountLabel(count: number): string {
  return count === 1 ? '1 ride' : `${count} rides`;
}

export function riderInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '?';
}

export function completedDeliveriesLabel(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count === 1 ? '1 delivery' : `${count} deliveries`;
}

export function offersMissingSince(previous: readonly string[], next: readonly string[]): boolean {
  const current = new Set(next);
  return previous.some((id) => !current.has(id));
}

function comparePrice(left: CustomerBid, right: CustomerBid): number {
  return Number(left.amount) - Number(right.amount);
}
