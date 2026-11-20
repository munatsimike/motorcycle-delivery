import { NEIGHBORHOOD_SPAN, zoomForSpan } from '../home/camera.ts';
import { isKnownDeliveryStatus, deliveryCanSearchAgain, type DeliveryCancellation, type DeliveryStatus } from './rules.ts';

export const TRACKING_POLL_MS = 8_000;
export const LIVE_LOCATION_MAX_AGE_MS = 60_000;
export const TRACKING_ZOOM_DELTA = 0.01;
export const TRACKING_MAP_HEIGHT = 480;
export const TRACKING_SHEET_OVERLAP = 72;
export const TRACKING_MARKER_CLEARANCE = 36;

export type RiderPoint = { latitude: number; longitude: number; updatedAt: string | null };
export type RoutePoint = { latitude: number; longitude: number };
export type PickupApproach = { metres: number; seconds: number; line: RoutePoint[] };
export type ServiceClass = 'EXPRESS' | 'FLEXIBLE';

export type AssignedRider = {
  name: string;
  verified: boolean;
  motorcycle: string | null;
  registrationNumber: string | null;
  colour: string | null;
  phone: string | null;
  hasProfilePhoto: boolean;
};

export type CustomerDeliveryRating = { eligible: boolean; submitted: boolean; stars: number | null };

export type CustomerDeliveryDetail = {
  id: string;
  status: DeliveryStatus;
  currency: string;
  offeredPrice: string | null;
  suggestedPrice: string;
  customerOffer: string | null;
  serviceClass: ServiceClass | null;
  deliverBy: string | null;
  distanceMeters: number;
  pickupAddress: string;
  senderName: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  dropoffAddress: string;
  recipientName: string | null;
  dropoffLatitude: number | null;
  dropoffLongitude: number | null;
  parcelDescription: string;
  pickupContactPhone: string | null;
  pickupLandmark: string | null;
  pickupInstructions: string | null;
  recipientPhone: string | null;
  dropoffLandmark: string | null;
  dropoffInstructions: string | null;
  parcelSize: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  parcelInstructions: string | null;
  paymentMethod: 'CASH' | 'ECOCASH' | 'ONEMONEY' | 'INNBUCKS' | 'ZIPIT' | null;
  cancellation: DeliveryCancellation | null;
  createdAt: string | null;
  completedAt: string | null;
  riderLocation: RiderPoint | null;
  pickupApproach: PickupApproach | null;
  rider: AssignedRider | null;
  rating: CustomerDeliveryRating;
};

export type RiderClassName = 'SILVER' | 'GOLD' | 'PLATINUM';
export type OfferSort = 'price' | 'price-high' | 'rides-low' | 'rides-high';

export type CustomerBid = {
  id: string;
  deliveryId: string;
  amount: string;
  currency: 'USD' | 'ZWG';
  status: 'OPEN' | 'WITHDRAWN' | 'ACCEPTED' | 'SUPERSEDED' | 'EXPIRED';
  riderName: string;
  completedDeliveries: number;
  averageRating: number | null;
  ratingCount: number;
  riderClass: RiderClassName;
  pickupEtaSeconds: number | null;
  motorcycle: string | null;
  registrationNumber: string | null;
  hasProfilePhoto: boolean;
  mapPoint: RoutePoint | null;
};

const LIVE_LOCATION = new Set<DeliveryStatus>(['RIDER_ASSIGNED', 'COLLECTING', 'COLLECTED', 'OUT_FOR_DELIVERY']);
const LIVE_POLL = new Set(['CREATED', 'RIDER_ASSIGNED', 'COLLECTING', 'COLLECTED', 'OUT_FOR_DELIVERY']);
const V1_PROGRESS = new Set(['SEARCHING', 'ASSIGNED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF']);
const CANCEL_BEFORE_PICKUP = new Set<DeliveryStatus>(['RIDER_ASSIGNED', 'COLLECTING']);

export function keepsRiderLocation(status: DeliveryStatus): boolean {
  return LIVE_LOCATION.has(status);
}

export function isMarketplaceDelivery(delivery: { serviceClass: ServiceClass | null; status?: string } | null): boolean {
  if (delivery?.serviceClass !== 'EXPRESS' && delivery?.serviceClass !== 'FLEXIBLE') return false;
  return !delivery.status || !V1_PROGRESS.has(delivery.status);
}

export function shouldPollDelivery(delivery: CustomerDeliveryDetail | null): boolean {
  return isMarketplaceDelivery(delivery) && delivery !== null && LIVE_POLL.has(delivery.status);
}

export function showsRiderOffers(delivery: { status: string; serviceClass: string | null } | null): boolean {
  return delivery?.status === 'CREATED' && (delivery.serviceClass === 'FLEXIBLE' || delivery.serviceClass === 'EXPRESS');
}

export function showsLiveTrackingMap(delivery: CustomerDeliveryDetail | null): boolean {
  if (!delivery || !keepsRiderLocation(delivery.status)) return false;
  if (delivery.status === 'COLLECTED' || delivery.status === 'OUT_FOR_DELIVERY') return true;
  return isMarketplaceDelivery(delivery);
}

export type TrackingMapView =
  | { kind: 'hidden' }
  | { kind: 'awaiting'; deliveryId: string; stop: RoutePoint | null; headingToDropoff: boolean }
  | { kind: 'live'; deliveryId: string; rider: RoutePoint; stop: RoutePoint | null; headingToDropoff: boolean };

/** Awaiting a fresh fix must not reuse the last stored rider coordinate. */
export function riderMarkerForMap(view: TrackingMapView): RoutePoint | null {
  return view.kind === 'live' ? view.rider : null;
}

export function offerMapMarkers(
  bids: readonly { mapPoint: RoutePoint | null; riderName: string }[],
): Array<RoutePoint & { title: string }> {
  return bids.flatMap((bid) => (bid.mapPoint ? [{ ...bid.mapPoint, title: bid.riderName }] : []));
}

export function withoutBidMapPoints<T extends { mapPoint: RoutePoint | null }>(bids: readonly T[]): T[] {
  return bids.map((bid) => (bid.mapPoint ? { ...bid, mapPoint: null } : bid));
}

export function trackingMapView(delivery: CustomerDeliveryDetail, now: number): TrackingMapView {
  if (!keepsRiderLocation(delivery.status)) return { kind: 'hidden' };
  const headingToDropoff = delivery.status === 'COLLECTED' || delivery.status === 'OUT_FOR_DELIVERY';
  const stop = headingToDropoff
    ? coordinate(delivery.dropoffLatitude, delivery.dropoffLongitude)
    : coordinate(delivery.pickupLatitude, delivery.pickupLongitude);
  const point = delivery.riderLocation;
  if (point && riderFixIsFresh(point.updatedAt, now)) {
    return { kind: 'live', deliveryId: delivery.id, rider: { latitude: point.latitude, longitude: point.longitude }, stop, headingToDropoff };
  }
  return { kind: 'awaiting', deliveryId: delivery.id, stop, headingToDropoff };
}

export function deliveryScreen(delivery: CustomerDeliveryDetail): 'offers' | 'tracking' | 'outcome' | 'status' {
  if (showsRiderOffers(delivery)) return 'offers';
  if (showsLiveTrackingMap(delivery)) return 'tracking';
  if (usesStatusBand(delivery)) return 'status';
  return 'outcome';
}

export function usesStatusBand(delivery: { status: DeliveryStatus; serviceClass: string | null }): boolean {
  if (delivery.status === 'SEARCHING' || delivery.status === 'ASSIGNED' || delivery.status === 'ARRIVED_AT_PICKUP') return true;
  return delivery.status === 'CREATED' && delivery.serviceClass !== 'EXPRESS' && delivery.serviceClass !== 'FLEXIBLE';
}

export function statusBandCopy(status: DeliveryStatus): { title: string; support: string } {
  if (status === 'ASSIGNED') return { title: 'Rider coming', support: 'A rider accepted this delivery.' };
  const title = status === 'SEARCHING' ? 'Finding a rider' : status === 'ARRIVED_AT_PICKUP' ? 'Rider at pickup' : status === 'CREATED' ? 'Pending' : 'Track Delivery';
  return { title, support: 'This is the latest status from your delivery.' };
}

export function detailViewState(input: { isLoading: boolean; error: string | null; hasDelivery: boolean }): 'loading' | 'error' | 'ready' {
  if (input.hasDelivery) return 'ready';
  if (input.error) return 'error';
  return 'loading';
}

export function riderFixIsFresh(updatedAt: string | null | undefined, now: number): boolean {
  if (!updatedAt) return false;
  const time = new Date(updatedAt).getTime();
  if (Number.isNaN(time)) return false;
  const age = now - time;
  return age >= -5_000 && age <= LIVE_LOCATION_MAX_AGE_MS;
}

export function locationAgeLabel(updatedAt: string | null | undefined, now: number): string | null {
  if (!updatedAt) return null;
  const time = new Date(updatedAt).getTime();
  if (Number.isNaN(time)) return null;
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 5) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'Updated 1 min ago' : `Updated ${minutes} min ago`;
}

export function roadDistanceLabel(metres: number): string | null {
  if (!Number.isFinite(metres) || metres < 0) return null;
  if (metres < 1000) return `${Math.round(metres)} m`;
  const kilometres = metres / 1000;
  return `${kilometres.toFixed(kilometres >= 10 ? 0 : 1)} km`;
}

export function arrivalLabel(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 30) return '0 min';
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

const EARTH_RADIUS_METRES = 6_371_000;
const PICKUP_ARRIVAL_METRES = 100;

export function straightLineMetres(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const latitudeARadians = toRadians(latitudeA);
  const latitudeBRadians = toRadians(latitudeB);
  const deltaLatitude = latitudeBRadians - latitudeARadians;
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeARadians) * Math.cos(latitudeBRadians) * Math.sin(deltaLongitude / 2) ** 2;
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return Math.floor(EARTH_RADIUS_METRES * arc + 0.5);
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

/** Straight-line metres from the accepted rider's fresh GPS to the stored pickup. Road-route metres are not used. */
export function pickupStraightLineMetres(
  delivery: Pick<CustomerDeliveryDetail, 'status' | 'pickupLatitude' | 'pickupLongitude' | 'riderLocation'>,
  now: number,
): number | null {
  if (delivery.status !== 'ASSIGNED' && delivery.status !== 'RIDER_ASSIGNED' && delivery.status !== 'COLLECTING') return null;
  const rider = delivery.riderLocation;
  const pickupLatitude = delivery.pickupLatitude;
  const pickupLongitude = delivery.pickupLongitude;
  if (!rider || !riderFixIsFresh(rider.updatedAt, now)) return null;
  if (pickupLatitude == null || pickupLongitude == null) return null;
  if (!Number.isFinite(rider.latitude) || !Number.isFinite(rider.longitude)) return null;
  if (!Number.isFinite(pickupLatitude) || !Number.isFinite(pickupLongitude)) return null;
  return straightLineMetres(rider.latitude, rider.longitude, pickupLatitude, pickupLongitude);
}

export function trackingHeadline(status: DeliveryStatus, distanceMetres?: number | null): string | null {
  if (status === 'ASSIGNED' || status === 'ARRIVED_AT_PICKUP' || status === 'RIDER_ASSIGNED' || status === 'COLLECTING') {
    if (status === 'ARRIVED_AT_PICKUP') return 'Rider arrived';
    if (distanceMetres != null && Number.isFinite(distanceMetres) && distanceMetres >= 0 && distanceMetres <= PICKUP_ARRIVAL_METRES) return 'Rider arrived';
    return status === 'RIDER_ASSIGNED' || status === 'COLLECTING' ? 'Rider coming' : 'Rider on the way';
  }
  if (status === 'PICKED_UP' || status === 'COLLECTED' || status === 'OUT_FOR_DELIVERY') return 'Parcel collected';
  if (status === 'IN_TRANSIT' || status === 'ARRIVED_AT_DROPOFF') return 'Your parcel is on the way';
  if (status === 'DELIVERED') return 'Parcel delivered';
  return null;
}

export function trackingSubtitle(headline: string | null, dropoffAddress?: string | null): string | null {
  if (headline === 'Rider coming' || headline === 'Rider on the way') return 'Your rider is coming to pick up your parcel.';
  if (headline === 'Rider arrived') return 'Handover your parcel to the rider.';
  if (headline === 'Parcel collected') {
    const address = dropoffAddress?.trim();
    return address ? `On its way to ${address}.` : null;
  }
  return null;
}

export function customerCanCancelDelivery(status: DeliveryStatus): boolean {
  return CANCEL_BEFORE_PICKUP.has(status);
}

export function deliveryActions(delivery: CustomerDeliveryDetail, now = Date.now()) {
  return {
    offers: showsRiderOffers(delivery),
    cancel: customerCanCancelDelivery(delivery.status),
    cancelRequest: showsRiderOffers(delivery),
    searchAgain: deliveryCanSearchAgain(delivery, now),
    deleteRequest: delivery.status === 'NO_RIDER_FOUND',
    adjustPrice: delivery.status === 'NO_RIDER_FOUND',
    contact: Boolean(riderDialUrl(delivery.rider?.phone ?? null)),
    parcel: true,
    rate: delivery.rating.eligible && !delivery.rating.submitted,
  };
}

export function showsCompletedRoute(delivery: CustomerDeliveryDetail): boolean {
  const inTransit = delivery.status === 'PICKED_UP'
    || delivery.status === 'IN_TRANSIT'
    || delivery.status === 'ARRIVED_AT_DROPOFF';
  return inTransit
    && delivery.pickupLatitude !== null
    && delivery.pickupLongitude !== null
    && delivery.dropoffLatitude !== null
    && delivery.dropoffLongitude !== null;
}

export function showsDeliveredDestination(delivery: CustomerDeliveryDetail): boolean {
  return delivery.status === 'DELIVERED' && delivery.dropoffLatitude !== null && delivery.dropoffLongitude !== null;
}

export function shouldShowRiderConfirmed(acceptedDeliveryId: string | null, deliveryId: string, dismissed: boolean): boolean {
  return acceptedDeliveryId === deliveryId && !dismissed;
}

export function riderPhotoPresentation(input: { hasProfilePhoto: boolean; photoUrl: string | null; failed: boolean }): 'photo' | 'initials' {
  return input.hasProfilePhoto && input.photoUrl && !input.failed ? 'photo' : 'initials';
}

export function offerFieldText(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned.slice(0, 4);
  return `${cleaned.slice(0, dot).slice(0, 4)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`;
}

export function customerOfferForBooking(value: string): { offeredPrice: string } | { error: string } {
  const trimmed = value.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(trimmed) || trimmed.endsWith('.')) {
    return { error: 'Enter an offer from $0.01 to $1,000.00.' };
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000) {
    return { error: 'Enter an offer from $0.01 to $1,000.00.' };
  }
  return { offeredPrice: `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}` };
}

export function receivedOfferCountLabel(count: number): string {
  return count === 1 ? '1 offer' : `${count} offers`;
}

export function activeOfferCountLabel(count: number): string {
  return count === 1 ? '1 offer received' : `${count} offers received`;
}

export function activeCustomerBids<T extends { id: string; status: string }>(
  bids: readonly T[],
  dismissedIds: ReadonlySet<string> = new Set(),
): T[] {
  return bids.filter((bid) => bid.status === 'OPEN' && !dismissedIds.has(bid.id));
}

export function offersMissingSince(previous: readonly string[], next: readonly string[]): boolean {
  const current = new Set(next);
  return previous.some((id) => !current.has(id));
}

export function bidCanAccept(bid: { status: string }): boolean {
  return bid.status === 'OPEN';
}

export function createAcceptanceGate() {
  let active = false;
  return {
    begin(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    end() {
      active = false;
    },
  };
}

export const RIDER_SELECTION_IN_PROGRESS = 'Rider selection is already in progress.';

export function duplicateAcceptanceNotice(began: boolean): string | null {
  return began ? null : RIDER_SELECTION_IN_PROGRESS;
}

export type BidAcceptance = {
  deliveryId: string;
  bidId: string;
  status: 'RIDER_ASSIGNED';
  acceptedBidAmount: string;
  replayed: boolean;
};

export function readBidAcceptance(value: unknown): BidAcceptance {
  if (!isRecord(value) || value.status !== 'RIDER_ASSIGNED') throw new Error('This offer could not be accepted.');
  if (typeof value.deliveryId !== 'string' || !value.deliveryId.trim()) throw new Error('This offer could not be accepted.');
  if (typeof value.bidId !== 'string' || !value.bidId.trim()) throw new Error('This offer could not be accepted.');
  if (typeof value.acceptedBidAmount !== 'string' || !/^\d{1,10}\.\d{2}$/.test(value.acceptedBidAmount)) throw new Error('This offer could not be accepted.');
  return {
    deliveryId: value.deliveryId,
    bidId: value.bidId,
    status: 'RIDER_ASSIGNED',
    acceptedBidAmount: value.acceptedBidAmount,
    replayed: value.replayed === true,
  };
}

export function keepsAcceptanceKey(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /timed out|network request failed|connection/i.test(message);
}

type AcceptanceStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const ACCEPTANCE_STORE = 'customer_bid_acceptance_v1';

export function acceptanceKeyFor(storage: AcceptanceStore, deliveryId: string, bidId: string, createKey: () => string): string {
  const saved = readAcceptanceKeys(storage);
  const id = `${deliveryId}:${bidId}`;
  const existing = saved[id];
  if (existing) return existing;
  const key = createKey().trim();
  if (!key || key.length > 200) throw new Error('This offer could not be accepted.');
  saved[id] = key;
  storage.setItem(ACCEPTANCE_STORE, JSON.stringify(saved));
  return key;
}

export function clearAcceptanceKey(storage: AcceptanceStore, deliveryId: string, bidId: string) {
  const saved = readAcceptanceKeys(storage);
  delete saved[`${deliveryId}:${bidId}`];
  storage.setItem(ACCEPTANCE_STORE, JSON.stringify(saved));
}

function readAcceptanceKeys(storage: AcceptanceStore): Record<string, string> {
  const raw = storage.getItem(ACCEPTANCE_STORE);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const keys: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) keys[id] = value;
    }
    return keys;
  } catch {
    return {};
  }
}

export function sortRiderOffers(bids: readonly CustomerBid[], sort: OfferSort): CustomerBid[] {
  return [...bids].sort((left, right) => {
    const price = Number(left.amount) - Number(right.amount);
    const rides = left.completedDeliveries - right.completedDeliveries;
    const primary = sort === 'rides-low' ? rides : sort === 'rides-high' ? -rides : sort === 'price-high' ? -price : price;
    const secondary = sort === 'price' || sort === 'price-high' ? rides : price;
    return primary || secondary || left.id.localeCompare(right.id);
  });
}

export function readRouteLine(value: unknown): RoutePoint[] {
  if (!isRecord(value) || !Array.isArray(value.line)) return [];
  return value.line.flatMap((point) => {
    if (!isRecord(point)) return [];
    const latitude = num(point.latitude, 90);
    const longitude = num(point.longitude, 180);
    return latitude === null || longitude === null ? [] : [{ latitude, longitude }];
  });
}

export function riderClassLabel(value: RiderClassName): string {
  if (value === 'GOLD') return 'Gold';
  if (value === 'PLATINUM') return 'Platinum';
  return 'Silver';
}

export function riderRatingLine(input: { averageRating: number | null; ratingCount: number; completedDeliveries: number }): { rating: string | null; rides: string } {
  const rides = input.completedDeliveries === 1 ? '1 ride' : `${input.completedDeliveries} rides`;
  if (input.ratingCount <= 0 || input.averageRating == null) return { rating: null, rides };
  return { rating: input.averageRating.toFixed(1), rides };
}

export function pickupEtaLabel(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 'ETA unavailable';
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? '1 min' : `${minutes} min`;
}

export function offerRiderName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return 'Rider';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first;
  const initial = Array.from(parts[parts.length - 1] ?? '')[0]?.toLocaleUpperCase() ?? '';
  return initial ? `${first} ${initial}.` : first;
}

export function riderInitials(name: string): string {
  const letters = name.trim().split(/\s+/).filter((part) => part.length > 0).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  return letters || 'R';
}

export function riderBikeLine(motorcycle: string | null, registrationNumber: string | null): string | null {
  const line = [motorcycle, registrationNumber].filter((part): part is string => Boolean(part)).join(' ');
  return line || null;
}

export function riderDialUrl(phone: string | null): string | null {
  const value = phone?.trim() ?? '';
  return /^\+[1-9]\d{7,14}$/.test(value) ? `tel:${value}` : null;
}

export function riderWhatsAppUrl(phone: string | null): string | null {
  const value = phone?.trim() ?? '';
  return /^\+[1-9]\d{7,14}$/.test(value) ? `https://wa.me/${value.slice(1)}` : null;
}

export function trackingCameraShouldMove(destinationChanged: boolean, gestured: boolean): { move: boolean; gestured: boolean } {
  if (destinationChanged && gestured) return { move: false, gestured: true };
  return { move: true, gestured: false };
}

export function showsTrackingRoute(pointCount: number): boolean {
  return pointCount > 1;
}

const OFFERS_LABEL_CLEARANCE = 72;
const OFFERS_MARKER_BLEED = 58;
const OFFERS_SIDE_CLEARANCE = 72;
const OFFERS_MIN_OPEN = 80;

export type OffersMapFrame = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

function offersPadding(width: number, height: number) {
  const sheet = TRACKING_SHEET_OVERLAP;
  let top = OFFERS_LABEL_CLEARANCE;
  let bleed = OFFERS_MARKER_BLEED;
  const spare = height - sheet - OFFERS_MIN_OPEN;
  if (top + bleed > spare) {
    const room = Math.max(0, spare);
    top = Math.min(OFFERS_LABEL_CLEARANCE, Math.round(room * 0.45));
    bleed = Math.min(OFFERS_MARKER_BLEED, Math.max(0, room - top));
  }
  const side = Math.min(OFFERS_SIDE_CLEARANCE, Math.max(16, Math.floor((width - 120) / 2)));
  return { top, bottom: sheet + bleed, left: side, right: side };
}

export function offersMapCamera(points: readonly RoutePoint[], width: number, height: number): OffersMapFrame {
  const safeWidth = width > 0 ? width : 360;
  const safeHeight = height > 0 ? height : 280;
  const padding = offersPadding(safeWidth, safeHeight);
  let minLatitude = points[0]?.latitude ?? -17.8292;
  let maxLatitude = minLatitude;
  let minLongitude = points[0]?.longitude ?? 31.0522;
  let maxLongitude = minLongitude;
  for (const point of points) {
    minLatitude = Math.min(minLatitude, point.latitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
  }
  const spanLatitude = Math.max((maxLatitude - minLatitude) * 1.25, NEIGHBORHOOD_SPAN);
  const spanLongitude = Math.max((maxLongitude - minLongitude) * 1.25, NEIGHBORHOOD_SPAN);
  const paddedWidth = Math.max(1, safeWidth - padding.left - padding.right);
  const paddedHeight = Math.max(1, safeHeight - padding.top - padding.bottom);
  const zoom = Math.min(zoomForSpan(spanLatitude, paddedHeight), zoomForSpan(spanLongitude, paddedWidth));
  const degreesPerPixel = 360 / (256 * 2 ** zoom);
  const offsetY = (padding.bottom - padding.top) / 2;
  return {
    latitude: (minLatitude + maxLatitude) / 2 - offsetY * degreesPerPixel,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: spanLatitude * (safeHeight / paddedHeight),
    longitudeDelta: spanLongitude * (safeWidth / paddedWidth),
  };
}

export function offersFrameHolds(points: readonly RoutePoint[], frame: OffersMapFrame, width: number, height: number): boolean {
  if (points.length === 0 || width <= 0 || height <= 0) return false;
  const padding = offersPadding(width, height);
  const zoom = Math.min(zoomForSpan(frame.latitudeDelta, height), zoomForSpan(frame.longitudeDelta, width));
  const degreesPerPixel = 360 / (256 * 2 ** zoom);
  return points.every((point) => {
    const x = width / 2 + (point.longitude - frame.longitude) / degreesPerPixel;
    const y = height / 2 - (point.latitude - frame.latitude) / degreesPerPixel;
    return x >= padding.left - 2 && x <= width - padding.right + 2 && y >= padding.top - 2 && y <= height - padding.bottom + 2;
  });
}

export function trackingCameraRegion(rider: RoutePoint, destination: RoutePoint | null): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } {
  const together = destination !== null
    && Math.abs(rider.latitude - destination.latitude) <= TRACKING_ZOOM_DELTA
    && Math.abs(rider.longitude - destination.longitude) <= TRACKING_ZOOM_DELTA;
  const focus = together && destination
    ? { latitude: (rider.latitude + destination.latitude) / 2, longitude: (rider.longitude + destination.longitude) / 2 }
    : rider;
  const openHeight = TRACKING_MAP_HEIGHT - TRACKING_SHEET_OVERLAP - TRACKING_MARKER_CLEARANCE;
  const latitudeDelta = TRACKING_ZOOM_DELTA * (TRACKING_MAP_HEIGHT / openHeight);
  const openCenter = TRACKING_MARKER_CLEARANCE + openHeight / 2;
  const southOfCenter = (TRACKING_MAP_HEIGHT / 2 - openCenter) / TRACKING_MAP_HEIGHT;
  return {
    latitude: focus.latitude - southOfCenter * latitudeDelta,
    longitude: focus.longitude,
    latitudeDelta,
    longitudeDelta: TRACKING_ZOOM_DELTA,
  };
}

export function readCustomerDeliveryDetail(value: unknown): CustomerDeliveryDetail {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) throw new Error('Delivery details are unavailable.');
  if (typeof value.status !== 'string' || !isKnownDeliveryStatus(value.status)) throw new Error('Delivery details are unavailable.');
  if (!isRecord(value.pickup) || !isRecord(value.dropoff) || !isRecord(value.parcel)) throw new Error('Delivery details are unavailable.');
  const pickupAddress = text(value.pickup.address);
  const dropoffAddress = text(value.dropoff.address);
  const parcelDescription = text(value.parcel.description);
  const suggestedPrice = text(value.suggestedPrice);
  const currency = text(value.currency);
  const pickupPoint = coordinatePair(value.pickup.latitude, value.pickup.longitude);
  const dropoffPoint = coordinatePair(value.dropoff.latitude, value.dropoff.longitude);
  const serviceClass = readServiceClass(value.serviceClass);
  const deliverBy = readDeadline(value.deliverBy);
  const offeredPrice = moneyOrNull(value.offeredPrice);
  if (!pickupAddress || !dropoffAddress || !parcelDescription || !suggestedPrice || !currency || offeredPrice === undefined || serviceClass === undefined || deliverBy === undefined || typeof value.distanceMeters !== 'number' || !Number.isFinite(value.distanceMeters)) {
    throw new Error('Delivery details are unavailable.');
  }
  return {
    id: value.id,
    status: value.status,
    currency,
    offeredPrice,
    suggestedPrice,
    customerOffer: moneyOrNull(value.customerOffer) ?? null,
    serviceClass,
    deliverBy,
    distanceMeters: value.distanceMeters,
    pickupAddress,
    senderName: text(value.pickup.contactName),
    pickupLatitude: pickupPoint?.latitude ?? null,
    pickupLongitude: pickupPoint?.longitude ?? null,
    dropoffAddress,
    recipientName: text(value.dropoff.contactName),
    dropoffLatitude: dropoffPoint?.latitude ?? null,
    dropoffLongitude: dropoffPoint?.longitude ?? null,
    parcelDescription,
    pickupContactPhone: text(value.pickup.contactPhone),
    pickupLandmark: text(value.pickup.landmark),
    pickupInstructions: text(value.pickup.instructions),
    recipientPhone: text(value.dropoff.contactPhone),
    dropoffLandmark: text(value.dropoff.landmark),
    dropoffInstructions: text(value.dropoff.instructions),
    parcelSize: readParcelSize(value.parcel.size),
    parcelInstructions: text(value.parcel.instructions),
    paymentMethod: readPaymentMethod(value.paymentMethod),
    cancellation: readCancellation(value.cancellation),
    createdAt: typeof value.createdAt === 'string' && value.createdAt.trim() ? value.createdAt : null,
    completedAt: readInstant(value.completedAt),
    riderLocation: keepsRiderLocation(value.status) ? readRiderPoint(value.riderLocation) : null,
    pickupApproach: keepsRiderLocation(value.status) ? readPickupApproach(value.pickupApproach) : null,
    rider: readAssignedRider(value.rider),
    rating: readRating(value.rating),
  };
}

export function readCustomerBids(value: unknown): CustomerBid[] {
  if (!Array.isArray(value)) throw new Error('Offers are unavailable.');
  return value.map(readBid);
}

const MONEY = /^\d{1,10}\.\d{2}$/;

function readBid(value: unknown): CustomerBid {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) throw new Error('Offers are unavailable.');
  if (typeof value.deliveryId !== 'string' || typeof value.amount !== 'string' || !MONEY.test(value.amount) || (value.currency !== 'USD' && value.currency !== 'ZWG')) throw new Error('Offers are unavailable.');
  if (value.status !== 'OPEN' && value.status !== 'WITHDRAWN' && value.status !== 'ACCEPTED' && value.status !== 'SUPERSEDED' && value.status !== 'EXPIRED') throw new Error('Offers are unavailable.');
  const rider = isRecord(value.rider) ? value.rider : null;
  const riderName = rider && typeof rider.name === 'string' ? rider.name.trim() : '';
  if (!riderName) throw new Error('Offers are unavailable.');
  return {
    id: value.id,
    deliveryId: value.deliveryId,
    amount: value.amount,
    currency: value.currency,
    status: value.status,
    riderName,
    completedDeliveries: typeof rider?.completedDeliveries === 'number' && rider.completedDeliveries >= 0 ? rider.completedDeliveries : 0,
    averageRating: typeof rider?.averageRating === 'number' && typeof rider.ratingCount === 'number' && rider.ratingCount > 0 ? rider.averageRating : null,
    ratingCount: typeof rider?.ratingCount === 'number' && rider.ratingCount >= 0 ? rider.ratingCount : 0,
    riderClass: rider?.riderClass === 'GOLD' || rider?.riderClass === 'PLATINUM' ? rider.riderClass : 'SILVER',
    pickupEtaSeconds: typeof rider?.pickupEtaSeconds === 'number' && rider.pickupEtaSeconds > 0 ? rider.pickupEtaSeconds : null,
    motorcycle: rider && typeof rider.motorcycle === 'string' && rider.motorcycle.trim() ? rider.motorcycle.trim() : null,
    registrationNumber: rider && typeof rider.registrationNumber === 'string' && rider.registrationNumber.trim() ? rider.registrationNumber.trim() : null,
    hasProfilePhoto: rider?.hasProfilePhoto === true,
    mapPoint: readMapPoint(rider?.mapPoint),
  };
}

function readMapPoint(value: unknown): RoutePoint | null {
  if (!isRecord(value)) return null;
  const latitude = num(value.latitude, 90);
  const longitude = num(value.longitude, 180);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function readAssignedRider(value: unknown): AssignedRider | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim()) return null;
  return {
    name: value.name.trim(),
    verified: value.verified === true,
    motorcycle: text(value.motorcycle),
    registrationNumber: text(value.registrationNumber),
    colour: text(value.colour),
    phone: text(value.phone),
    hasProfilePhoto: value.hasProfilePhoto === true,
  };
}

function readRating(value: unknown): CustomerDeliveryRating {
  if (!isRecord(value)) return { eligible: false, submitted: false, stars: null };
  const submitted = value.submitted === true;
  const stars = typeof value.stars === 'number' && Number.isInteger(value.stars) && value.stars >= 1 && value.stars <= 5 ? value.stars : null;
  return { eligible: value.eligible === true && !submitted, submitted, stars: submitted ? stars : null };
}

function readRiderPoint(value: unknown): RiderPoint | null {
  if (!isRecord(value)) return null;
  const latitude = num(value.latitude, 90);
  const longitude = num(value.longitude, 180);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude, updatedAt: readInstant(value.updatedAt) };
}

function readPickupApproach(value: unknown): PickupApproach | null {
  if (!isRecord(value) || typeof value.metres !== 'number' || typeof value.seconds !== 'number') return null;
  if (!Number.isFinite(value.metres) || value.metres < 0 || !Number.isFinite(value.seconds) || value.seconds < 0) return null;
  const line = Array.isArray(value.line) ? value.line.flatMap((point) => {
    if (!isRecord(point)) return [];
    const latitude = num(point.latitude, 90);
    const longitude = num(point.longitude, 180);
    return latitude === null || longitude === null ? [] : [{ latitude, longitude }];
  }) : [];
  return { metres: value.metres, seconds: value.seconds, line };
}

function coordinate(latitude: number | null, longitude: number | null): RoutePoint | null {
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function coordinatePair(latitude: unknown, longitude: unknown): RoutePoint | null {
  const parsedLatitude = num(latitude, 90);
  const parsedLongitude = num(longitude, 180);
  if (parsedLatitude === null || parsedLongitude === null) return null;
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

function readParcelSize(value: unknown): 'SMALL' | 'MEDIUM' | 'LARGE' | null {
  if (value === 'SMALL' || value === 'MEDIUM' || value === 'LARGE') return value;
  return null;
}

function readPaymentMethod(value: unknown): 'CASH' | 'ECOCASH' | 'ONEMONEY' | 'INNBUCKS' | 'ZIPIT' | null {
  if (value === 'CASH' || value === 'ECOCASH' || value === 'ONEMONEY' || value === 'INNBUCKS' || value === 'ZIPIT') return value;
  return null;
}

function readCancellation(value: unknown): DeliveryCancellation | null {
  if (!isRecord(value)) return null;
  if (value.actor !== 'RIDER' && value.actor !== 'CUSTOMER' && value.actor !== 'SYSTEM') return null;
  return { actor: value.actor, reason: text(value.reason), afterPickup: value.afterPickup === true };
}

function readServiceClass(value: unknown): ServiceClass | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'EXPRESS' || value === 'FLEXIBLE') return value;
  return undefined;
}

function readDeadline(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return undefined;
  return value;
}

function moneyOrNull(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return text(value);
}

function readInstant(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return null;
  return value;
}

function num(value: unknown, limit: number): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < -limit || numeric > limit) return null;
  return numeric;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
