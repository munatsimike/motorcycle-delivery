import { describe, expect, it } from 'vitest';

import {
  deliveryCardAddress,
  deliveryContentKind,
  deliveryDetailAddress,
  deliveryWhenLabel,
  shortDeliveryReference,
} from './deliveryCard';

describe('delivery card text', () => {
  it('shows the last five characters of the delivery id', () => {
    expect(shortDeliveryReference('11111111-2222-3333-4444-abcd1024')).toBe('#D1024');
  });

  it('hides only the country on the details address', () => {
    expect(deliveryDetailAddress('66 Mungongoma Road, Mufakose, Harare, Zimbabwe')).toBe('66 Mungongoma Road, Mufakose, Harare');
  });

  it('hides the country and city from the card address', () => {
    expect(deliveryCardAddress('66 Mungongoma Road, Mufakose, Harare, Zimbabwe')).toBe('66 Mungongoma Rd, Mufakose');
    expect(deliveryCardAddress('12 Samora Machel Avenue, Bulawayo')).toBe('12 Samora Machel Ave');
    expect(deliveryCardAddress('4 Jason Moyo Street, Harare')).toBe('4 Jason Moyo St');
    expect(deliveryCardAddress('8 Mukuvisi Close, Harare')).toBe('8 Mukuvisi Cl');
    expect(deliveryCardAddress('3 Borrowdale Drive')).toBe('3 Borrowdale Dr');
    expect(deliveryCardAddress('5 Hillside Crescent')).toBe('5 Hillside Cres');
    expect(deliveryCardAddress('2 Acacia Lane')).toBe('2 Acacia Ln');
    expect(deliveryCardAddress('9 Royal Court')).toBe('9 Royal Ct');
    expect(deliveryCardAddress('1 Market Place')).toBe('1 Market Pl');
    expect(deliveryCardAddress('6 Unity Boulevard')).toBe('6 Unity Blvd');
    expect(deliveryCardAddress('7 Ridge Terrace')).toBe('7 Ridge Ter');
    expect(deliveryCardAddress('Harare, Zimbabwe')).toBe('Harare');
    expect(deliveryCardAddress('12 Samora Machel Avenue')).toBe('12 Samora Machel Ave');
    expect(deliveryCardAddress('12 Samora Machel Ave')).toBe('12 Samora Machel Ave');
  });

  it('maps parcel, document, and food badges', () => {
    expect(deliveryContentKind('Parcel')).toBe('parcel');
    expect(deliveryContentKind(' Document ')).toBe('document');
    expect(deliveryContentKind('Documents')).toBe('document');
    expect(deliveryContentKind('Food')).toBe('food');
    expect(deliveryContentKind(null)).toBe('parcel');
  });

  it('shows the date and clock time', () => {
    const createdAt = new Date(2026, 9, 15, 18, 25, 0).toISOString();
    expect(deliveryWhenLabel(createdAt)).toBe('15 Oct 2026 • 18:25');
  });

  it('keeps yesterday as a date', () => {
    const createdAt = new Date(2026, 9, 14, 9, 5, 0).toISOString();
    expect(deliveryWhenLabel(createdAt)).toBe('14 Oct 2026 • 09:05');
  });
});
