import { BadRequestException } from '@nestjs/common';
import { Currency } from '../generated/prisma/client.js';
import {
  formatZigPerUsd,
  readZigPerUsd,
  riderZwgOffersEnabled,
  suggestedCentsForCurrency,
  zigCentsFromUsdCents,
  zigPerUsdUnits,
} from './exchange-rate.js';
import { readQuoteRequest, readV2DeliveryDraft } from './delivery-request.js';

const NOW = new Date('2026-11-16T22:00:00.000Z');
const RATE_33 = { rateVersion: 1, zigPerUsdUnits: 330_000, zigPerUsd: '33.0000' };

describe('exchange rate conversion', () => {
  it('converts a USD suggestion at 33 ZiG and rounds half up to cents', () => {
    expect(zigCentsFromUsdCents(300, 330_000)).toBe(9_900);
    expect(zigCentsFromUsdCents(100, 333_333)).toBe(3_333);
    expect(zigCentsFromUsdCents(150, 330_000)).toBe(4_950);
    expect(zigCentsFromUsdCents(1, 330_000)).toBe(33);
    expect(zigCentsFromUsdCents(100, 330_050)).toBe(3_301);
    expect(formatZigPerUsd(330_000)).toBe('33.0000');
    expect(zigPerUsdUnits('33.00')).toBe(330_000);
  });

  it('accepts a positive bounded rate and rejects the rest', () => {
    expect(readZigPerUsd({ zigPerUsd: '33.00' })).toEqual({ units: 330_000, text: '33.0000' });
    expect(readZigPerUsd({ zigPerUsd: '0.0001' }).units).toBe(1);
    expect(() => readZigPerUsd({ zigPerUsd: '0' })).toThrow(BadRequestException);
    expect(() => readZigPerUsd({ zigPerUsd: '-1' })).toThrow(BadRequestException);
    expect(() => readZigPerUsd({ zigPerUsd: '33.00001' })).toThrow(BadRequestException);
    expect(() => readZigPerUsd({ zigPerUsd: '1000001' })).toThrow(BadRequestException);
  });

  it('keeps a USD suggestion and converts only ZiG', () => {
    expect(suggestedCentsForCurrency(300, Currency.USD, RATE_33)).toBe(300);
    expect(suggestedCentsForCurrency(300, Currency.ZWG, RATE_33)).toBe(9_900);
    expect(() => suggestedCentsForCurrency(300, Currency.ZWG, null)).toThrow('An exchange rate has not been published');
  });

  it('turns ZiG rider offers on only for the exact flag', () => {
    expect(riderZwgOffersEnabled({})).toBe(false);
    expect(riderZwgOffersEnabled({ RIDER_ZWG_OFFERS_ENABLED: 'false' })).toBe(false);
    expect(riderZwgOffersEnabled({ RIDER_ZWG_OFFERS_ENABLED: 'true' })).toBe(true);
  });
});

describe('booking currency', () => {
  const stop = (contactName: string, contactPhone: string) => ({
    latitude: -17.8292,
    longitude: 31.0522,
    address: '12 Samora Machel Avenue',
    contactName,
    contactPhone,
    placeId: 'ChIJstreet0001',
    coordinateSource: 'GOOGLE_PLACES',
  });
  const pins = {
    pickup: stop('Tariro Moyo', '0771234567'),
    dropoff: stop('Rudo Ncube', '0777654321'),
    parcel: { description: 'Parcel', size: 'SMALL' },
    serviceClass: 'FLEXIBLE',
    offeredPrice: '4.50',
    paymentMethod: 'CASH',
  };

  it('defaults a missing currency to USD and accepts ZiG', () => {
    expect(readV2DeliveryDraft(pins, NOW).currency).toBe(Currency.USD);
    expect(readV2DeliveryDraft({ ...pins, currency: 'ZWG' }, NOW).currency).toBe(Currency.ZWG);
    expect(readQuoteRequest({ ...pins, currency: 'ZWG' }).currency).toBe(Currency.ZWG);
    expect(() => readV2DeliveryDraft({ ...pins, currency: 'ZWL' }, NOW)).toThrow('Choose USD or ZiG');
  });
});
