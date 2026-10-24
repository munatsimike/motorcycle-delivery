import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PricingModel, PricingWindowKind, ServiceClass } from '../generated/prisma/client.js';
import { suggestedCents } from './straight-line.js';
import {
  calculateTariffPrice,
  PricingCalculationError,
  type PricingTierSnapshot,
  type PricingWindowSnapshot,
  type TariffSnapshot,
} from './pricing-calculator.js';

const AT = new Date('2026-01-05T10:00:00.000Z');

describe('pricing calculator', () => {
  it('prices all four models in integer cents', () => {
    expect(calculateTariffPrice(tariff({ pricingModel: PricingModel.FIXED, baseFeeCents: 250 }), 3_000, AT)).toMatchObject({
      pricingModel: 'FIXED',
      serviceClass: 'EXPRESS',
      distanceMetres: 3_000,
      pricingWindow: null,
      basisPoints: 0,
      suggestedPriceCents: 250,
    });
    expect(calculateTariffPrice(tariff({
      pricingModel: PricingModel.PER_KILOMETRE,
      baseFeeCents: 900,
      pricePerKilometreCents: 100,
    }), 1_500, AT).suggestedPriceCents).toBe(150);
    const basePlus = tariff({
      pricingModel: PricingModel.BASE_PLUS_PER_KILOMETRE,
      baseFeeCents: 200,
      pricePerKilometreCents: 50,
    });
    expect(calculateTariffPrice(basePlus, 1_500, AT).suggestedPriceCents)
      .toBe(suggestedCents(1_500, basePlus));
    expect(calculateTariffPrice(tierTariff(), 2_500, AT).suggestedPriceCents).toBe(450);
  });

  it('splits 1500 metres into 1000 at the first rate and 500 at the second', () => {
    const snapshot = tierTariff([
      { position: 1, upToMetres: 1_000, amountCents: 1_000 },
      { position: 2, upToMetres: 3_000, amountCents: 2_000 },
    ]);
    expect(calculateTariffPrice(snapshot, 1_000, AT).suggestedPriceCents).toBe(1_000);
    expect(calculateTariffPrice(snapshot, 1_001, AT).suggestedPriceCents).toBe(1_002);
    expect(calculateTariffPrice(snapshot, 1_500, AT).suggestedPriceCents).toBe(2_000);
  });

  it('charges only the metres inside each tier and stops on an exact boundary', () => {
    const snapshot = tierTariff([
      { position: 1, upToMetres: 1_000, amountCents: 100 },
      { position: 2, upToMetres: 3_000, amountCents: 500 },
    ]);
    expect(calculateTariffPrice(snapshot, 1_000, AT).suggestedPriceCents).toBe(100);
    expect(calculateTariffPrice(snapshot, 1_001, AT).suggestedPriceCents).toBe(101);
    expect(calculateTariffPrice(snapshot, 0, AT).suggestedPriceCents).toBe(0);
    const openEnded = tierTariff([
      { position: 1, upToMetres: 1_000, amountCents: 100 },
      { position: 2, upToMetres: null, amountCents: 200 },
    ]);
    expect(calculateTariffPrice(openEnded, 3_000, AT).suggestedPriceCents).toBe(500);
    expect(() => calculateTariffPrice(openEnded, 3_001, AT)).toThrow('Trip is outside the configured range');
  });

  it('rounds each marginal slice with the existing half-up per-kilometre step', () => {
    const snapshot = tariff({
      pricingModel: PricingModel.DISTANCE_TIERS,
      maximumTripMetres: 2_000,
      tiers: [
        { position: 1, upToMetres: 1_000, amountCents: 1 },
        { position: 2, upToMetres: 2_000, amountCents: 1 },
      ],
    });
    expect(calculateTariffPrice(snapshot, 499, AT).suggestedPriceCents).toBe(0);
    expect(calculateTariffPrice(snapshot, 500, AT).suggestedPriceCents).toBe(1);
    expect(calculateTariffPrice(snapshot, 1_500, AT).suggestedPriceCents).toBe(2);
  });

  it('matches a window that crosses midnight in Africa/Harare', () => {
    const night = window({
      id: 'night',
      kind: PricingWindowKind.NIGHT,
      daysOfWeek: [1],
      startsAt: '22:00',
      endsAt: '02:00',
      adjustmentBasisPoints: 1_000,
    });
    const snapshot = tariff({ baseFeeCents: 1_000, windows: [night] });
    const mondayEvening = new Date('2026-01-05T20:00:00.000Z');
    const tuesdayEarly = new Date('2026-01-05T23:00:00.000Z');
    const before = new Date('2026-01-05T18:59:00.000Z');
    const atEnd = new Date('2026-01-06T00:00:00.000Z');

    expect(calculateTariffPrice(snapshot, 0, mondayEvening)).toMatchObject({ pricingWindow: { id: 'night', kind: 'NIGHT' }, basisPoints: 1_000, suggestedPriceCents: 1_100 });
    expect(calculateTariffPrice(snapshot, 0, tuesdayEarly)).toMatchObject({ pricingWindow: { id: 'night' }, basisPoints: 1_000, suggestedPriceCents: 1_100 });
    expect(calculateTariffPrice(snapshot, 0, before).basisPoints).toBe(0);
    expect(calculateTariffPrice(snapshot, 0, atEnd).basisPoints).toBe(0);

    const fullTurn = tariff({
      baseFeeCents: 1_000,
      windows: [window({
        id: 'turn',
        kind: PricingWindowKind.NIGHT,
        daysOfWeek: [1],
        startsAt: '22:00',
        endsAt: '22:00',
        adjustmentBasisPoints: 1_000,
      })],
    });
    expect(calculateTariffPrice(fullTurn, 0, new Date('2026-01-05T20:30:00.000Z')).basisPoints).toBe(1_000);
    expect(calculateTariffPrice(fullTurn, 0, new Date('2026-01-05T23:30:00.000Z')).basisPoints).toBe(1_000);
    expect(calculateTariffPrice(fullTurn, 0, new Date('2026-01-05T06:00:00.000Z')).basisPoints).toBe(0);
  });

  it('uses Harare local time when the UTC weekday is different', () => {
    const monday = window({
      id: 'monday',
      daysOfWeek: [1],
      startsAt: '00:00',
      endsAt: '01:00',
      adjustmentBasisPoints: 1_000,
    });
    const sunday = window({
      id: 'sunday',
      daysOfWeek: [7],
      startsAt: '22:00',
      endsAt: '23:00',
      adjustmentBasisPoints: 2_000,
    });
    const snapshot = tariff({ baseFeeCents: 1_000, windows: [monday, sunday] });
    const harareMonday = new Date('2026-01-04T22:30:00.000Z');

    expect(calculateTariffPrice(snapshot, 0, harareMonday)).toMatchObject({
      pricingWindow: { id: 'monday' },
      basisPoints: 1_000,
      suggestedPriceCents: 1_100,
    });
  });

  it('applies one window, with Night ahead of Peak and Peak ahead of Off-peak', () => {
    const snapshot = tariff({
      baseFeeCents: 1_000,
      windows: [
        window({ id: 'off', kind: PricingWindowKind.OFF_PEAK, adjustmentBasisPoints: 100, createdAt: new Date('2026-01-05T00:00:00.000Z') }),
        window({ id: 'peak', kind: PricingWindowKind.PEAK, adjustmentBasisPoints: 500, createdAt: new Date('2026-01-06T00:00:00.000Z') }),
        window({ id: 'night', kind: PricingWindowKind.NIGHT, adjustmentBasisPoints: 1_000, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      ],
    });
    expect(calculateTariffPrice(snapshot, 0, AT)).toMatchObject({
      pricingWindow: { id: 'night', kind: 'NIGHT' },
      basisPoints: 1_000,
      suggestedPriceCents: 1_100,
    });

    const withoutNight = tariff({
      baseFeeCents: 1_000,
      windows: [
        window({ id: 'off', kind: PricingWindowKind.OFF_PEAK, adjustmentBasisPoints: 100 }),
        window({ id: 'peak', kind: PricingWindowKind.PEAK, adjustmentBasisPoints: 500, enabled: false }),
      ],
    });
    expect(calculateTariffPrice(withoutNight, 0, AT)).toMatchObject({
      pricingWindow: { id: 'off', kind: 'OFF_PEAK' },
      basisPoints: 100,
      suggestedPriceCents: 1_010,
    });
  });

  it('uses the latest saved window when two of the same kind overlap', () => {
    const older = window({ id: 'older', adjustmentBasisPoints: 100, createdAt: new Date('2026-01-01T00:00:00.000Z') });
    const newer = window({ id: 'newer', adjustmentBasisPoints: 200, createdAt: new Date('2026-01-02T00:00:00.000Z') });
    const savedTogether = tariff({
      baseFeeCents: 1_000,
      windows: [
        window({ id: 'a', adjustmentBasisPoints: 300, createdAt: new Date('2026-01-03T00:00:00.000Z') }),
        window({ id: 'b', adjustmentBasisPoints: 400, createdAt: new Date('2026-01-03T00:00:00.000Z') }),
      ],
    });
    expect(calculateTariffPrice(tariff({ baseFeeCents: 1_000, windows: [older, newer] }), 0, AT)).toMatchObject({
      pricingWindow: { id: 'newer' },
      basisPoints: 200,
      suggestedPriceCents: 1_020,
    });
    expect(calculateTariffPrice(savedTogether, 0, AT).pricingWindow).toEqual({ id: 'b', kind: 'PEAK' });
  });

  it('leaves the tariff unadjusted when no enabled window matches', () => {
    const snapshot = tariff({
      baseFeeCents: 250,
      windows: [
        window({ id: 'other-day', daysOfWeek: [2] }),
        window({ id: 'disabled', enabled: false, adjustmentBasisPoints: 5_000 }),
      ],
    });
    expect(calculateTariffPrice(snapshot, 0, AT)).toMatchObject({
      pricingWindow: null,
      basisPoints: 0,
      suggestedPriceCents: 250,
    });
  });

  it('rounds positive and negative basis points half away from zero', () => {
    expect(adjusted(100, 50)).toBe(101);
    expect(adjusted(100, 49)).toBe(100);
    expect(adjusted(100, -50)).toBe(100);
    expect(adjusted(100, -51)).toBe(99);
    expect(adjusted(1, 5_000)).toBe(2);
    expect(adjusted(1, -5_000)).toBe(1);
    expect(adjusted(1_000, 1_000)).toBe(1_100);
    expect(adjusted(1_000, -1_000)).toBe(900);
    expect(adjusted(1_000, -10_000)).toBe(0);
    expect(() => adjusted(100, -15_000)).toThrow(PricingCalculationError);
    expect(() => adjusted(100, -15_000)).toThrow('Suggested price is negative');
  });

  it('does not recalculate a quote from a later tariff version', () => {
    const published = tariff({ pricingVersion: 1, baseFeeCents: 200, windows: [] });
    const first = calculateTariffPrice(published, 1_000, AT);
    const replacement = tariff({
      pricingVersion: 2,
      baseFeeCents: 900,
      windows: [window({ adjustmentBasisPoints: 2_000 })],
    });
    published.baseFeeCents = 900;
    published.pricingVersion = 2;
    published.windows.push(window({ id: 'later', adjustmentBasisPoints: 2_000 }));

    expect(first).toEqual({
      pricingVersion: 1,
      pricingModel: 'FIXED',
      serviceClass: 'EXPRESS',
      distanceMetres: 1_000,
      pricingWindow: null,
      basisPoints: 0,
      suggestedPriceCents: 200,
    });
    expect(calculateTariffPrice(replacement, 1_000, AT)).toMatchObject({
      pricingVersion: 2,
      basisPoints: 2_000,
      suggestedPriceCents: 1_080,
    });
  });

  it('rejects malformed money, tiers, windows, and trips outside the range', () => {
    expect(() => calculateTariffPrice(tariff({ baseFeeCents: -1 }), 0, AT)).toThrow('base fee is negative');
    expect(() => calculateTariffPrice(tariff({ pricePerKilometreCents: -1 }), 0, AT)).toThrow('price per kilometre is negative');
    expect(() => calculateTariffPrice(tariff({ pricingModel: 'PARCEL' as PricingModel }), 0, AT)).toThrow('pricing model is invalid');
    expect(() => calculateTariffPrice(tariff({ minimumTripMetres: 100, maximumTripMetres: 50 }), 100, AT)).toThrow('maximum trip is invalid');
    expect(() => calculateTariffPrice(tariff(), 10_001, AT)).toThrow('Trip is outside the configured range');
    expect(() => calculateTariffPrice(tariff(), 1.5, AT)).toThrow('Distance is invalid');
    expect(() => calculateTariffPrice(tierTariff([
      { position: 1, upToMetres: 1_000, amountCents: 100 },
      { position: 2, upToMetres: 2_000, amountCents: 100 },
    ]), 1_000, AT)).toThrow('do not cover the configured range');
    expect(() => calculateTariffPrice(tierTariff([
      { position: 1, upToMetres: 2_000, amountCents: 100 },
      { position: 2, upToMetres: 1_500, amountCents: 100 },
    ]), 1_000, AT)).toThrow('tier boundaries overlap');
    expect(() => calculateTariffPrice(tierTariff([
      { position: 1, upToMetres: 1_000, amountCents: -5 },
    ]), 0, AT)).toThrow('tier amount is negative');
    expect(() => calculateTariffPrice(tierTariff([
      { position: 1, upToMetres: 1_000, amountCents: 100 },
      { position: 3, upToMetres: 3_000, amountCents: 100 },
    ]), 0, AT)).toThrow('tier positions have a gap');
    expect(() => calculateTariffPrice(tierTariff([
      { position: 1, upToMetres: null, amountCents: 100 },
      { position: 2, upToMetres: 3_000, amountCents: 100 },
    ]), 0, AT)).toThrow('an open tier is not last');
    expect(() => calculateTariffPrice(tierTariff([
      { position: 1, upToMetres: 4_000, amountCents: 100 },
    ]), 0, AT)).toThrow('extend beyond the configured range');
    expect(() => calculateTariffPrice(tariff({ tiers: [{ position: 1, upToMetres: 1_000, amountCents: 100 }] }), 0, AT))
      .toThrow('tiers belong only to the distance-tier model');
    expect(() => calculateTariffPrice(tariff({ windows: [window({ startsAt: '24:00' })] }), 0, AT)).toThrow('window time is invalid');
    expect(() => calculateTariffPrice(tariff({ windows: [window({ endsAt: '12:60' })] }), 0, AT)).toThrow('window time is invalid');
    expect(() => calculateTariffPrice(tariff({ windows: [window({ daysOfWeek: [] })] }), 0, AT)).toThrow('window days are invalid');
    expect(() => calculateTariffPrice(tariff({ windows: [window({ daysOfWeek: [0] })] }), 0, AT)).toThrow('window days are invalid');
    expect(() => calculateTariffPrice(tariff({ windows: [window({ daysOfWeek: [1, 1] })] }), 0, AT)).toThrow('window days are invalid');
    expect(() => calculateTariffPrice(tariff({ windows: [window({ adjustmentBasisPoints: 1.5 })] }), 0, AT)).toThrow('basis points are invalid');
    expect(() => calculateTariffPrice(tariff(), 0, new Date('not-a-date'))).toThrow('Pricing instant is invalid');
  });

  it('keeps V1 quote and delivery creation on the existing formula', () => {
    const source = readFileSync('src/delivery/delivery.service.ts', 'utf8');
    const v1Quote = source.slice(source.indexOf('async quote('), source.indexOf('async create('));
    const create = source.slice(source.indexOf('async create('), source.indexOf('private async createV2Request'));
    expect(v1Quote).toContain('priceMetres');
    expect(v1Quote).not.toContain('calculateTariffPrice');
    expect(create).toContain('priceMetres');
    expect(create).not.toContain('calculateTariffPrice');
    expect(source.slice(source.indexOf('private async createV2Request'))).toContain('calculateTariffPrice');
    expect(source).toContain('suggestedCents');
  });
});

function adjusted(baseFeeCents: number, basisPoints: number): number {
  return calculateTariffPrice(tariff({
    baseFeeCents,
    windows: [window({ adjustmentBasisPoints: basisPoints })],
  }), 0, AT).suggestedPriceCents;
}

function tariff(overrides: Partial<TariffSnapshot> = {}): TariffSnapshot {
  return {
    pricingVersion: 1,
    pricingModel: PricingModel.FIXED,
    serviceClass: ServiceClass.EXPRESS,
    baseFeeCents: 200,
    pricePerKilometreCents: 100,
    minimumTripMetres: 0,
    maximumTripMetres: 10_000,
    tiers: [],
    windows: [],
    ...overrides,
  };
}

function tierTariff(tiers?: PricingTierSnapshot[]): TariffSnapshot {
  return tariff({
    pricingModel: PricingModel.DISTANCE_TIERS,
    maximumTripMetres: 3_000,
    tiers: tiers ?? [
      { position: 1, upToMetres: 1_000, amountCents: 100 },
      { position: 2, upToMetres: 2_000, amountCents: 200 },
      { position: 3, upToMetres: 3_000, amountCents: 300 },
    ],
  });
}

function window(overrides: Partial<PricingWindowSnapshot> = {}): PricingWindowSnapshot {
  return {
    id: 'peak',
    kind: PricingWindowKind.PEAK,
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    startsAt: '00:00',
    endsAt: '23:59',
    adjustmentBasisPoints: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
