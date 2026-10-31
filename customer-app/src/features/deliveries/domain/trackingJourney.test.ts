import { describe, expect, it } from 'vitest';
import {
  customerCanCancelDelivery,
  readAssignedRider,
  riderDialUrl,
  riderWhatsAppCallUrl,
  riderInitials,
  shouldShowAssignmentNotice,
  trackingHeadline,
} from './trackingJourney';

describe('tracking journey', () => {
  it('maps backend statuses to the sender-facing stages', () => {
    expect(trackingHeadline('RIDER_ASSIGNED')).toBe('Rider on the way');
    expect(trackingHeadline('COLLECTING')).toBe('Rider on the way');
    expect(trackingHeadline('RIDER_ASSIGNED', 0)).toBe('Rider arrived');
    expect(trackingHeadline('COLLECTING', 0.4)).toBe('Rider arrived');
    expect(trackingHeadline('RIDER_ASSIGNED', 12)).toBe('Rider on the way');
    expect(trackingHeadline('COLLECTED', 0)).toBe('Parcel collected');
    expect(trackingHeadline('COLLECTED')).toBe('Parcel collected');
    expect(trackingHeadline('OUT_FOR_DELIVERY')).toBe('Your parcel is on the way');
    expect(trackingHeadline('DELIVERED')).toBe('Parcel delivered');
    expect(trackingHeadline('CREATED')).toBeNull();
  });

  it('allows cancellation only before pickup', () => {
    expect(customerCanCancelDelivery('RIDER_ASSIGNED')).toBe(true);
    expect(customerCanCancelDelivery('COLLECTING')).toBe(true);
    expect(customerCanCancelDelivery('ASSIGNED')).toBe(false);
    expect(customerCanCancelDelivery('ARRIVED_AT_PICKUP')).toBe(false);
    expect(customerCanCancelDelivery('COLLECTED')).toBe(false);
    expect(customerCanCancelDelivery('OUT_FOR_DELIVERY')).toBe(false);
    expect(customerCanCancelDelivery('DELIVERED')).toBe(false);
  });

  it('shows the rider confirmation only immediately after acceptance', () => {
    expect(shouldShowAssignmentNotice(true)).toBe(true);
    expect(shouldShowAssignmentNotice(false)).toBe(false);
  });

  it('reads the assigned rider and keeps the phone off the dialer until it is valid', () => {
    expect(readAssignedRider({ name: 'Tendai Moyo', verified: true, motorcycle: 'Honda Ace', phone: '+263771000001', hasProfilePhoto: true })).toEqual({
      name: 'Tendai Moyo',
      verified: true,
      motorcycle: 'Honda Ace',
      phone: '+263771000001',
      hasProfilePhoto: true,
    });
    expect(readAssignedRider({ name: 'Tendai', verified: false })).toMatchObject({ phone: null, motorcycle: null });
    expect(readAssignedRider(null)).toBeNull();
    expect(riderInitials('Tendai Moyo')).toBe('TM');
    expect(riderDialUrl('+263771000001')).toBe('tel:+263771000001');
    expect(riderDialUrl('0771000001')).toBeNull();
    expect(riderWhatsAppCallUrl('+263771000001')).toBe('whatsapp://send?phone=263771000001');
    expect(riderWhatsAppCallUrl('0771000001')).toBeNull();
  });
});
