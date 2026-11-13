import type { Palette } from '../../../theme';
import type { DeliveryStatus } from '../domain/deliveryStatus';

export type StatusTone = {
  background: string;
  color: string;
};

const STATUS_TONES: Record<Exclude<DeliveryStatus, 'NO_RIDER_FOUND'>, StatusTone> = {
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

export function deliveryStatusTone(status: DeliveryStatus, colors: Palette, offersReceived = false): StatusTone {
  if (offersReceived) {
    return { background: colors.offerSurface, color: colors.offer };
  }
  if (status === 'NO_RIDER_FOUND') {
    return { background: colors.noRiderSurface, color: colors.noRider };
  }
  return STATUS_TONES[status];
}
