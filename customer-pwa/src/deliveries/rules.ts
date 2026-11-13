export const DELIVERY_STATUSES = [
  'CREATED',
  'SEARCHING',
  'NO_RIDER_FOUND',
  'ASSIGNED',
  'ARRIVED_AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_DROPOFF',
  'RIDER_ASSIGNED',
  'COLLECTING',
  'COLLECTED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryGroup = 'active' | 'history';
export type ServiceClass = 'EXPRESS' | 'FLEXIBLE';
export type DeliveryContentKind = 'parcel' | 'document' | 'food';
export type DeliveryListSort = 'newest' | 'oldest' | 'shortest' | 'longest' | 'highest' | 'lowest';

export type CustomerDelivery = {
  id: string;
  status: DeliveryStatus;
  createdAt: string;
  pickupAddress: string;
  dropoffAddress: string;
  serviceClass: ServiceClass | null;
  deliverBy: string | null;
  currency: 'USD' | null;
  suggestedPrice: string | null;
  offeredPrice: string | null;
  distanceMeters: number | null;
  parcelDescription: string | null;
  openBidCount: number;
};

const ACTIVE = new Set<DeliveryStatus>([
  'CREATED', 'SEARCHING', 'NO_RIDER_FOUND', 'ASSIGNED', 'ARRIVED_AT_PICKUP', 'PICKED_UP',
  'IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'RIDER_ASSIGNED', 'COLLECTING', 'COLLECTED', 'OUT_FOR_DELIVERY',
]);

export const ACTIVE_LIST_STATUSES: readonly DeliveryStatus[] = [...ACTIVE];
export const HISTORY_LIST_STATUSES: readonly DeliveryStatus[] = ['DELIVERED', 'CANCELLED', 'FAILED'];

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  CREATED: 'Pending',
  SEARCHING: 'Finding a rider',
  NO_RIDER_FOUND: 'No rider found',
  ASSIGNED: 'Rider assigned',
  ARRIVED_AT_PICKUP: 'Rider at pickup',
  PICKED_UP: 'Parcel picked up',
  IN_TRANSIT: 'In transit',
  ARRIVED_AT_DROPOFF: 'At dropoff',
  RIDER_ASSIGNED: 'Rider coming',
  COLLECTING: 'Rider coming',
  COLLECTED: 'Collected',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

const STATUS_TONES: Record<Exclude<DeliveryStatus, 'NO_RIDER_FOUND'>, { background: string; color: string }> = {
  CREATED: { background: '#EEF2F6', color: '#475569' },
  SEARCHING: { background: '#EEF2F6', color: '#475569' },
  ASSIGNED: { background: '#E9F8EF', color: '#087A4A' },
  ARRIVED_AT_PICKUP: { background: '#E9F8EF', color: '#087A4A' },
  PICKED_UP: { background: '#E9F8EF', color: '#087A4A' },
  IN_TRANSIT: { background: '#E7F1FF', color: '#2563EB' },
  ARRIVED_AT_DROPOFF: { background: '#E9F8EF', color: '#087A4A' },
  RIDER_ASSIGNED: { background: '#E5F6ED', color: '#16845B' },
  COLLECTING: { background: '#E5F6ED', color: '#16845B' },
  COLLECTED: { background: '#E7F1FF', color: '#2563EB' },
  OUT_FOR_DELIVERY: { background: '#E7F1FF', color: '#2563EB' },
  DELIVERED: { background: '#E9F8EF', color: '#087A4A' },
  CANCELLED: { background: '#F1F3F5', color: '#606B75' },
  FAILED: { background: '#FDECEC', color: '#D92D20' },
};

const CARD_CITIES = new Set([
  'harare', 'bulawayo', 'chitungwiza', 'mutare', 'epworth', 'gweru', 'kwekwe', 'kadoma', 'masvingo',
  'chinhoyi', 'norton', 'marondera', 'ruwa', 'chegutu', 'zvishavane', 'bindura', 'beitbridge',
  'redcliff', 'victoria falls', 'hwange', 'chiredzi', 'kariba', 'karoi', 'chipinge', 'gwanda', 'shurugwi',
]);

const STREET_TYPES: Record<string, string> = {
  road: 'Rd', street: 'St', avenue: 'Ave', close: 'Cl', drive: 'Dr', crescent: 'Cres',
  lane: 'Ln', court: 'Ct', place: 'Pl', boulevard: 'Blvd', terrace: 'Ter',
};

const STREET_TYPE_PATTERN = new RegExp(`\\b(${Object.keys(STREET_TYPES).join('|')})\\b`, 'gi');

export function isKnownDeliveryStatus(status: string): status is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(status);
}

export function deliveryGroup(status: DeliveryStatus): DeliveryGroup {
  return ACTIVE.has(status) ? 'active' : 'history';
}

export function deliveryCardStatusLabel(delivery: Pick<CustomerDelivery, 'status' | 'serviceClass' | 'deliverBy' | 'openBidCount'>): string {
  const count = showsViewBids(delivery) ? delivery.openBidCount : 0;
  if (count === 1) return '1 offer received';
  if (count > 1) return `${count} offers received`;
  if (delivery.status === 'COLLECTED' || delivery.status === 'OUT_FOR_DELIVERY') return 'In transit';
  if (delivery.serviceClass && delivery.status === 'CREATED') return 'Waiting for offers';
  return STATUS_LABELS[delivery.status];
}

export function showsViewBids(delivery: Pick<CustomerDelivery, 'status' | 'serviceClass' | 'openBidCount'>): boolean {
  return delivery.status === 'CREATED'
    && (delivery.serviceClass === 'EXPRESS' || delivery.serviceClass === 'FLEXIBLE')
    && delivery.openBidCount > 0;
}

export function deliveryCanSearchAgain(
  delivery: Pick<CustomerDelivery, 'status' | 'serviceClass' | 'deliverBy'>,
  now = Date.now(),
): boolean {
  if (delivery.status !== 'NO_RIDER_FOUND' || delivery.serviceClass == null) return false;
  if (delivery.serviceClass !== 'EXPRESS' && delivery.serviceClass !== 'FLEXIBLE') return false;
  if (delivery.deliverBy == null || delivery.deliverBy === '') return true;
  const deadline = new Date(delivery.deliverBy).getTime();
  return Number.isFinite(deadline) && deadline > now;
}

export function deliveryStatusTone(status: DeliveryStatus, offersReceived = false): { background: string; color: string } {
  if (offersReceived) return { background: '#F3E8FF', color: '#7C3AED' };
  if (status === 'NO_RIDER_FOUND') return { background: '#FFF3DF', color: '#D97706' };
  return STATUS_TONES[status];
}

export function deliveryContentKind(description: string | null | undefined): DeliveryContentKind {
  const value = description?.trim().toLowerCase() ?? '';
  if (value === 'food') return 'food';
  if (value === 'document' || value === 'documents' || value === 'doc') return 'document';
  return 'parcel';
}

export function deliveryCardAddress(address: string): string {
  const parts = address.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'zimbabwe') parts.pop();
  if (parts.length > 1 && CARD_CITIES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  return parts.map((part) => part.replace(STREET_TYPE_PATTERN, (word) => STREET_TYPES[word.toLowerCase()] ?? word)).join(', ');
}

export function contentLabel(kind: DeliveryContentKind): string {
  if (kind === 'document') return 'Document';
  if (kind === 'food') return 'Food';
  return 'Parcel';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const IN_TRANSIT_OUTCOME = new Set<DeliveryStatus>([
  'PICKED_UP', 'COLLECTED', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'OUT_FOR_DELIVERY',
]);

export function shortDeliveryReference(id: string): string {
  const tail = id.replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase();
  return tail.length > 0 ? `#${tail}` : id;
}

export function deliveryWhenLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} • ${hours}:${minutes}`;
}

export function deliveryDistanceLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return 'Unavailable';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const kilometres = meters / 1000;
  const text = kilometres >= 10 ? String(Math.round(kilometres)) : kilometres.toFixed(1);
  return `${text} km`;
}

export function moneyLabel(currency: string, amount: string): string {
  const mark = currency.trim().toUpperCase() === 'USD' ? '$' : currency.trim();
  return mark === '$' ? `${mark}${amount}` : `${mark} ${amount}`;
}

export function deliveryOutcomeTitle(status: DeliveryStatus): string {
  return IN_TRANSIT_OUTCOME.has(status) ? 'In transit' : STATUS_LABELS[status];
}

export function deliveryOutcomeSupport(status: DeliveryStatus): string {
  if (status === 'NO_RIDER_FOUND') return 'No rider was available for this delivery.';
  if (status === 'COLLECTED' || status === 'PICKED_UP') return 'Your parcel has been collected. Delivery is in progress.';
  if (status === 'OUT_FOR_DELIVERY' || status === 'IN_TRANSIT' || status === 'ARRIVED_AT_DROPOFF') return 'Delivery is in progress.';
  if (status === 'DELIVERED') return 'This delivery is complete.';
  if (status === 'CANCELLED') return 'This delivery was cancelled.';
  if (status === 'FAILED') return 'This delivery could not be completed.';
  return 'This is the latest status from your delivery.';
}

export function outcomeShowsRider(status: DeliveryStatus): boolean {
  return deliveryOutcomeTitle(status) === 'In transit';
}

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

export function customerDeliveryListPath(page: number, statuses: readonly DeliveryStatus[]): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', '20');
  for (const status of statuses) params.append('status', status);
  return `/customers/me/deliveries?${params.toString()}`;
}

export function readCustomerDeliveryPage(value: unknown): { deliveries: CustomerDelivery[]; page: number; totalPages: number } {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pagination)) {
    throw new Error('Deliveries are unavailable.');
  }
  const page = wholeNumber(value.pagination.page);
  const totalPages = wholeNumber(value.pagination.totalPages);
  if (page === null || totalPages === null) throw new Error('Deliveries are unavailable.');
  return { deliveries: uniqueDeliveries(value.data.map(readCustomerDelivery)), page, totalPages };
}

export function replaceDeliveries(incoming: CustomerDelivery[]): CustomerDelivery[] {
  return uniqueDeliveries(incoming);
}

export function appendDeliveries(current: CustomerDelivery[], incoming: CustomerDelivery[]): CustomerDelivery[] {
  return uniqueDeliveries([...current, ...incoming]);
}

export function savedDeliveryMessage(savedAt: string): string | null {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `Last updated ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}. Statuses may have changed.`;
}

function compareDeliveries(left: CustomerDelivery, right: CustomerDelivery, sort: DeliveryListSort): number {
  const rule = SORT_RULE[sort];
  const primary = rule.field === 'distance'
    ? compareMissingLast(left.distanceMeters, right.distanceMeters, rule.direction)
    : rule.field === 'price'
      ? compareMissingLast(deliveryPrice(left), deliveryPrice(right), rule.direction)
      : compareMissingLast(deliveryTime(left.createdAt), deliveryTime(right.createdAt), rule.direction);
  if (primary !== 0) return primary;
  const date = compareMissingLast(deliveryTime(left.createdAt), deliveryTime(right.createdAt), 'desc');
  if (date !== 0) return date;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function deliveryPrice(delivery: CustomerDelivery): number | null {
  return money(delivery.offeredPrice) ?? money(delivery.suggestedPrice);
}

function money(value: string | null): number | null {
  if (!value || !/^\d{1,10}\.\d{2}$/.test(value)) return null;
  return Number(value);
}

function deliveryTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareMissingLast(left: number | null, right: number | null, direction: 'asc' | 'desc'): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === 'asc' ? left - right : right - left;
}

function readCustomerDelivery(value: unknown): CustomerDelivery {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim().length === 0) throw new Error('Deliveries are unavailable.');
  if (typeof value.status !== 'string' || !isKnownDeliveryStatus(value.status)) throw new Error('Deliveries are unavailable.');
  if (typeof value.reference !== 'string' || value.reference.trim().length === 0) throw new Error('Deliveries are unavailable.');
  if (typeof value.createdAt !== 'string' || value.createdAt.trim().length === 0) throw new Error('Deliveries are unavailable.');
  const pickupAddress = addressOf(value.pickup);
  const dropoffAddress = addressOf(value.dropoff);
  if (!pickupAddress || !dropoffAddress) throw new Error('Deliveries are unavailable.');
  const serviceClass = readServiceClass(value.serviceClass);
  const deliverBy = readDeadline(value.deliverBy);
  const suggestedPrice = readMoney(value.suggestedPrice);
  const offeredPrice = readMoney(value.offeredPrice);
  const currency = readCurrency(value.currency);
  const openBidCount = readOpenBidCount(value.openBidCount);
  if (serviceClass === undefined || deliverBy === undefined || suggestedPrice === undefined || offeredPrice === undefined || currency === undefined || openBidCount === undefined) {
    throw new Error('Deliveries are unavailable.');
  }
  return {
    id: value.id,
    status: value.status,
    createdAt: value.createdAt,
    pickupAddress,
    dropoffAddress,
    serviceClass,
    deliverBy,
    currency,
    suggestedPrice,
    offeredPrice,
    distanceMeters: readDistance(value.distanceMeters),
    parcelDescription: readParcelDescription(value.parcel),
    openBidCount,
  };
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

function readMoney(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{1,10}\.\d{2}$/.test(value)) return undefined;
  return value;
}

function readCurrency(value: unknown): 'USD' | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (value !== 'USD') return undefined;
  return 'USD';
}

function readDistance(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function readOpenBidCount(value: unknown): number | undefined {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return undefined;
}

function readParcelDescription(value: unknown): string | null {
  if (!isRecord(value) || typeof value.description !== 'string') return null;
  const description = value.description.trim();
  return description.length > 0 ? description.slice(0, 500) : null;
}

function addressOf(value: unknown): string | null {
  if (!isRecord(value) || typeof value.address !== 'string' || value.address.trim().length === 0) return null;
  return value.address.trim();
}

function uniqueDeliveries(deliveries: CustomerDelivery[]): CustomerDelivery[] {
  const seen = new Set<string>();
  const unique: CustomerDelivery[] = [];
  for (const delivery of deliveries) {
    if (seen.has(delivery.id)) continue;
    seen.add(delivery.id);
    unique.push(delivery);
  }
  return unique;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
