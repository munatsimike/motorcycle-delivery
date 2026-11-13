import { describe, expect, it } from 'vitest';
import {
  customerCanCancelDelivery,
  readAssignedRider,
  riderDialUrl,
  riderWhatsAppCallUrl,
  riderBikeLine,
  riderInitials,
  ASSIGNMENT_NOTICE_MS,
  assignmentNoticeVisible,
  shouldShowAssignmentNotice,
  trackingHeadline,
  trackingSubtitle,
} from './trackingJourney';

describe('tracking journey', () => {
  it('maps backend statuses to the sender-facing stages', () => {
    expect(trackingHeadline('RIDER_ASSIGNED')).toBe('Rider coming');
    expect(trackingHeadline('COLLECTING')).toBe('Rider coming');
    expect(trackingHeadline('RIDER_ASSIGNED', 0)).toBe('Rider arrived');
    expect(trackingHeadline('COLLECTING', 0.4)).toBe('Rider arrived');
    expect(trackingHeadline('RIDER_ASSIGNED', 12)).toBe('Rider coming');
    expect(trackingHeadline('COLLECTED', 0)).toBe('Parcel collected');
    expect(trackingHeadline('COLLECTED')).toBe('Parcel collected');
    expect(trackingHeadline('OUT_FOR_DELIVERY')).toBe('Parcel collected');
    expect(trackingHeadline('DELIVERED')).toBe('Parcel delivered');
    expect(trackingHeadline('CREATED')).toBeNull();
    expect(trackingSubtitle('Rider coming')).toBe('Your rider is coming to pick up your parcel.');
    expect(trackingSubtitle('Rider arrived')).toBe('Handover your parcel to the rider.');
    expect(trackingSubtitle('Parcel collected', '12 Nelson Mandela Avenue, Harare')).toBe('On its way to 12 Nelson Mandela Avenue, Harare.');
    expect(trackingSubtitle('Parcel collected', '  ')).toBeNull();
    expect(trackingSubtitle('Parcel collected')).toBeNull();
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
    expect(assignmentNoticeVisible(true, 0)).toBe(true);
    expect(assignmentNoticeVisible(true, ASSIGNMENT_NOTICE_MS - 1)).toBe(true);
    expect(assignmentNoticeVisible(true, ASSIGNMENT_NOTICE_MS)).toBe(false);
    expect(assignmentNoticeVisible(false, 0)).toBe(false);
  });

  it('reads the assigned rider and keeps the phone off the dialer until it is valid', () => {
    expect(readAssignedRider({ name: 'Tendai Moyo', verified: true, motorcycle: 'Honda Ace', registrationNumber: 'ABC 1234', colour: 'Red', phone: '+263771000001', hasProfilePhoto: true })).toEqual({
      name: 'Tendai Moyo',
      verified: true,
      motorcycle: 'Honda Ace',
      registrationNumber: 'ABC 1234',
      colour: 'Red',
      phone: '+263771000001',
      hasProfilePhoto: true,
    });
    expect(readAssignedRider({ name: 'Tendai', verified: false })).toMatchObject({ phone: null, motorcycle: null, registrationNumber: null, colour: null });
    expect(riderBikeLine('Honda Ace', 'ABC 1234')).toBe('Honda Ace ABC 1234');
    expect(riderBikeLine('Honda Ace', null)).toBe('Honda Ace');
    expect(riderBikeLine(null, null)).toBeNull();
    expect(readAssignedRider(null)).toBeNull();
    expect(riderInitials('Tendai Moyo')).toBe('TM');
    expect(riderDialUrl('+263771000001')).toBe('tel:+263771000001');
    expect(riderDialUrl('0771000001')).toBeNull();
    expect(riderWhatsAppCallUrl('+263771000001')).toBe('whatsapp://send?phone=263771000001');
    expect(riderWhatsAppCallUrl('0771000001')).toBeNull();
  });
});
