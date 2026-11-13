import { describe, expect, it } from 'vitest';
import {
  basisPointsFromPercent,
  draftFromTariff,
  emptyDraft,
  overlapWarnings,
  percentFromBasisPoints,
  reviewClassTariff,
  schedulesOverlap,
  type WindowDraft,
} from './class-pricing';
import type { ClassTariff } from './types';

describe('class tariff drafts', () => {
  it('starts from a blank draft', () => {
    expect(emptyDraft()).toEqual({
      pricingModel: '',
      baseFee: '',
      pricePerKilometre: '',
      includedKilometres: '',
      minimumTripMetres: '',
      maximumTripMetres: '',
      tiers: [],
      windows: [],
    });
  });

  it('omits stored unused money when a class tariff is loaded', () => {
    const draft = draftFromTariff(tariff({ pricingModel: 'FIXED', baseFee: '3.50', pricePerKilometre: '0.00' }));
    expect(draft.baseFee).toBe('3.50');
    expect(draft.pricePerKilometre).toBe('');
    expect(draft.tiers).toEqual([]);
  });

  it('builds the publish body for each model', () => {
    expect(reviewClassTariff({
      ...emptyDraft(),
      pricingModel: 'FIXED',
      baseFee: '3.50',
      minimumTripMetres: '0',
      maximumTripMetres: '10000',
    })).toEqual({
      body: {
        pricingModel: 'FIXED',
        currency: 'USD',
        baseFee: '3.50',
        minimumTripMetres: 0,
        maximumTripMetres: 10000,
        windows: [],
      },
    });
    const perKilometre = reviewClassTariff({
      ...emptyDraft(),
      pricingModel: 'PER_KILOMETRE',
      pricePerKilometre: '1.25',
      minimumTripMetres: '0',
      maximumTripMetres: '10000',
    });
    if (!('body' in perKilometre)) {
      throw new Error(perKilometre.error);
    }
    expect(perKilometre.body.pricePerKilometre).toBe('1.25');
    expect(perKilometre.body.baseFee).toBeUndefined();
    const tiers = reviewClassTariff({
      ...emptyDraft(),
      pricingModel: 'DISTANCE_TIERS',
      minimumTripMetres: '0',
      maximumTripMetres: '5000',
      tiers: [
        { key: 'a', upToMetres: '1000', amount: '1.00' },
        { key: 'b', upToMetres: '5000', amount: '2.00' },
      ],
    });
    expect(tiers).toEqual({
      body: {
        pricingModel: 'DISTANCE_TIERS',
        currency: 'USD',
        minimumTripMetres: 0,
        maximumTripMetres: 5000,
        tiers: [
          { position: 1, upToMetres: 1000, amount: '1.00' },
          { position: 2, upToMetres: 5000, amount: '2.00' },
        ],
        windows: [],
      },
    });
  });

  it('serializes included distance from kilometres and reloads it', () => {
    const reviewed = reviewClassTariff({
      ...emptyDraft(),
      pricingModel: 'INCLUDED_DISTANCE',
      baseFee: '5.00',
      pricePerKilometre: '0.80',
      includedKilometres: '5',
      minimumTripMetres: '100',
      maximumTripMetres: '100000',
    });
    expect(reviewed).toEqual({
      body: {
        pricingModel: 'INCLUDED_DISTANCE',
        currency: 'USD',
        baseFee: '5.00',
        pricePerKilometre: '0.80',
        includedMetres: 5000,
        minimumTripMetres: 100,
        maximumTripMetres: 100000,
        windows: [],
      },
    });
    expect(reviewClassTariff({
      ...emptyDraft(),
      pricingModel: 'INCLUDED_DISTANCE',
      baseFee: '5.00',
      pricePerKilometre: '0.80',
      includedKilometres: '5.001',
      minimumTripMetres: '100',
      maximumTripMetres: '100000',
    })).toMatchObject({ body: { includedMetres: 5001 } });
    const loaded = draftFromTariff(tariff({
      pricingModel: 'INCLUDED_DISTANCE',
      baseFee: '5.00',
      pricePerKilometre: '0.80',
      includedMetres: 5000,
      minimumTripMetres: 100,
      maximumTripMetres: 100000,
    }));
    expect(loaded.includedKilometres).toBe('5');
    expect(loaded.baseFee).toBe('5.00');
    expect(loaded.pricePerKilometre).toBe('0.80');
    const older = draftFromTariff(tariff({ pricingModel: 'FIXED', baseFee: '3.50', includedMetres: null }));
    expect(older.includedKilometres).toBe('');
    expect(older.baseFee).toBe('3.50');
  });

  it('rejects an included distance that is blank, finer than a metre, or outside the trip', () => {
    const draft = {
      ...emptyDraft(),
      pricingModel: 'INCLUDED_DISTANCE' as const,
      baseFee: '5.00',
      pricePerKilometre: '0.80',
      minimumTripMetres: '100',
      maximumTripMetres: '100000',
    };
    expect(reviewClassTariff({ ...draft, includedKilometres: '' })).toEqual({
      error: 'Enter the included distance in kilometres. Use up to three decimal places.',
    });
    expect(reviewClassTariff({ ...draft, includedKilometres: '5.0001' })).toEqual({
      error: 'Enter the included distance in kilometres. Use up to three decimal places.',
    });
    expect(reviewClassTariff({ ...draft, includedKilometres: '0.05' })).toEqual({
      error: 'Included distance must be inside the minimum and maximum trip.',
    });
  });

  it('rejects a tier list that does not reach the maximum', () => {
    expect(reviewClassTariff({
      ...emptyDraft(),
      pricingModel: 'DISTANCE_TIERS',
      minimumTripMetres: '0',
      maximumTripMetres: '5000',
      tiers: [
        { key: 'a', upToMetres: '1000', amount: '1.00' },
        { key: 'b', upToMetres: '4000', amount: '2.00' },
      ],
    })).toEqual({ error: 'The last tier must end at the maximum trip distance.' });
  });

  it('converts percentages to basis points', () => {
    expect(basisPointsFromPercent('5')).toBe(500);
    expect(basisPointsFromPercent('-2.5')).toBe(-250);
    expect(basisPointsFromPercent('5.05')).toBe(505);
    expect(percentFromBasisPoints(-250)).toBe('-2.5');
    expect(basisPointsFromPercent('5.555')).toBeNull();
  });

  it('warns when windows overlap and ignores an exclusive boundary', () => {
    const morning = window({ startsAt: '08:00', endsAt: '10:00' });
    const next = window({ key: 'b', startsAt: '10:00', endsAt: '12:00' });
    const overlap = window({ key: 'c', startsAt: '09:00', endsAt: '11:00' });
    expect(schedulesOverlap(morning, next)).toBe(false);
    expect(schedulesOverlap(morning, overlap)).toBe(true);
    expect(overlapWarnings([morning, overlap])[0]).toContain('stay as entered');
    const night = window({ key: 'night', daysOfWeek: [1], startsAt: '22:00', endsAt: '02:00' });
    const early = window({ key: 'early', daysOfWeek: [2], startsAt: '01:00', endsAt: '03:00' });
    const later = window({ key: 'later', daysOfWeek: [2], startsAt: '03:00', endsAt: '04:00' });
    expect(schedulesOverlap(night, early)).toBe(true);
    expect(schedulesOverlap(night, later)).toBe(false);
  });
});

function window(patch: Partial<WindowDraft>): WindowDraft {
  return {
    key: 'a',
    id: null,
    kind: 'PEAK',
    enabled: true,
    daysOfWeek: [1],
    startsAt: '08:00',
    endsAt: '10:00',
    percent: '0',
    ...patch,
  };
}

function tariff(patch: Partial<ClassTariff>): ClassTariff {
  return {
    serviceClass: 'EXPRESS',
    pricingVersion: 1,
    pricingModel: 'FIXED',
    currency: 'USD',
    baseFee: '1.00',
    pricePerKilometre: '0.00',
    includedMetres: null,
    minimumTripMetres: 0,
    maximumTripMetres: 10000,
    isActive: true,
    tiers: [],
    windows: [],
    ...patch,
  };
}
