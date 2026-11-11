import type { DeliveryStatus } from '../domain/deliveryStatus';

export type StatusTone = {
  background: string;
  color: string;
};

const OFFER_TONE: StatusTone = { background: '#FFF3D6', color: '#A66300' };

const STATUS_TONES: Record<DeliveryStatus, StatusTone> = {
  CREATED: { background: '#EEF2F6', color: '#475569' },
  SEARCHING: { background: '#EEF2F6', color: '#475569' },
  NO_RIDER_FOUND: { background: '#FDECEC', color: '#C0392B' },
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

export function deliveryStatusTone(status: DeliveryStatus, offersReceived = false): StatusTone {
  return offersReceived ? OFFER_TONE : STATUS_TONES[status];
}
