import { moneyValue, wholeMetres } from './money';
import type { ClassTariff, PricingModel, PricingWindow, PricingWindowKind, ServiceClassName } from './types';

export const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
] as const;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PERCENT = /^[+-]?\d{1,6}(\.\d{1,2})?$/;

export type TierDraft = {
  key: string;
  upToMetres: string;
  amount: string;
};

export type WindowDraft = {
  key: string;
  id: string | null;
  kind: PricingWindowKind;
  enabled: boolean;
  daysOfWeek: number[];
  startsAt: string;
  endsAt: string;
  percent: string;
};

export type ClassDraft = {
  pricingModel: PricingModel | '';
  baseFee: string;
  pricePerKilometre: string;
  includedKilometres: string;
  minimumTripMetres: string;
  maximumTripMetres: string;
  tiers: TierDraft[];
  windows: WindowDraft[];
};

export type ClassPublishWindow = {
  kind: PricingWindowKind;
  enabled: boolean;
  daysOfWeek: number[];
  startsAt: string;
  endsAt: string;
  adjustmentBasisPoints: number;
};

export type ClassPublishBody = {
  pricingModel: PricingModel;
  currency: 'USD';
  baseFee?: string;
  pricePerKilometre?: string;
  includedMetres?: number;
  minimumTripMetres: number;
  maximumTripMetres: number;
  tiers?: Array<{ position: number; upToMetres: number; amount: string }>;
  windows: ClassPublishWindow[];
};

export function serviceName(serviceClass: ServiceClassName): string {
  return serviceClass === 'EXPRESS' ? 'Express' : 'Flexible';
}

export function usesBaseFee(model: PricingModel | ''): boolean {
  return model === 'FIXED' || model === 'BASE_PLUS_PER_KILOMETRE' || model === 'INCLUDED_DISTANCE';
}

export function usesPerKilometre(model: PricingModel | ''): boolean {
  return model === 'PER_KILOMETRE' || model === 'BASE_PLUS_PER_KILOMETRE' || model === 'INCLUDED_DISTANCE';
}

const KILOMETRES = /^\d{1,7}(\.\d{1,3})?$/;

export function metresFromKilometres(input: string): number | null {
  const value = input.trim();
  if (!KILOMETRES.test(value)) {
    return null;
  }
  const [whole, fraction = ''] = value.split('.');
  const metres = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(metres) || metres <= 0 || metres > 2_000_000_000) {
    return null;
  }
  return metres;
}

export function kilometresFromMetres(metres: number): string {
  const whole = Math.trunc(metres / 1000);
  const fraction = metres % 1000;
  if (fraction === 0) {
    return String(whole);
  }
  return `${whole}.${String(fraction).padStart(3, '0').replace(/0+$/, '')}`;
}

export function emptyDraft(): ClassDraft {
  return {
    pricingModel: '',
    baseFee: '',
    pricePerKilometre: '',
    includedKilometres: '',
    minimumTripMetres: '',
    maximumTripMetres: '',
    tiers: [],
    windows: [],
  };
}

export function draftFromTariff(tariff: ClassTariff): ClassDraft {
  return {
    pricingModel: tariff.pricingModel,
    baseFee: usesBaseFee(tariff.pricingModel) ? tariff.baseFee : '',
    pricePerKilometre: usesPerKilometre(tariff.pricingModel) ? tariff.pricePerKilometre : '',
    includedKilometres: tariff.pricingModel === 'INCLUDED_DISTANCE' && tariff.includedMetres
      ? kilometresFromMetres(tariff.includedMetres)
      : '',
    minimumTripMetres: String(tariff.minimumTripMetres),
    maximumTripMetres: String(tariff.maximumTripMetres),
    tiers: tariff.pricingModel === 'DISTANCE_TIERS'
      ? tariff.tiers
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((tier) => ({
          key: tier.id,
          upToMetres: tier.upToMetres === null ? String(tariff.maximumTripMetres) : String(tier.upToMetres),
          amount: tier.amount,
        }))
      : [],
    windows: tariff.windows.map((window) => ({
      key: window.id,
      id: window.id,
      kind: window.kind,
      enabled: window.enabled,
      daysOfWeek: orderedDays(window.daysOfWeek),
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      percent: percentFromBasisPoints(window.adjustmentBasisPoints),
    })),
  };
}

export function percentFromBasisPoints(basisPoints: number): string {
  const sign = basisPoints < 0 ? '-' : '';
  const absolute = Math.abs(basisPoints);
  const whole = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  if (fraction === 0) {
    return `${sign}${whole}`;
  }
  if (fraction % 10 === 0) {
    return `${sign}${whole}.${fraction / 10}`;
  }
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}

export function basisPointsFromPercent(input: string): number | null {
  const value = input.trim().replace(/%$/, '');
  if (!PERCENT.test(value)) {
    return null;
  }
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(basisPoints)) {
    return null;
  }
  return negative ? -basisPoints : basisPoints;
}

export function clockMinutes(value: string): number | null {
  const match = CLOCK.exec(value.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function crossesMidnight(startsAt: string, endsAt: string): boolean {
  const start = clockMinutes(startsAt);
  const end = clockMinutes(endsAt);
  return start !== null && end !== null && end <= start;
}

export function reviewClassTariff(draft: ClassDraft): { body: ClassPublishBody } | { error: string } {
  if (!draft.pricingModel) {
    return { error: 'Choose a pricing model.' };
  }
  const minimumTripMetres = wholeMetres(draft.minimumTripMetres);
  const maximumTripMetres = wholeMetres(draft.maximumTripMetres);
  if (minimumTripMetres === null || maximumTripMetres === null || maximumTripMetres <= minimumTripMetres) {
    return { error: 'Enter the minimum and maximum trip in metres. The maximum must be greater than the minimum.' };
  }
  const body: ClassPublishBody = {
    pricingModel: draft.pricingModel,
    currency: 'USD',
    minimumTripMetres,
    maximumTripMetres,
    windows: [],
  };
  if (usesBaseFee(draft.pricingModel)) {
    const baseFee = moneyValue(draft.baseFee, true);
    if (!baseFee) {
      return { error: 'Enter the base fee in dollars and cents. Zero is allowed.' };
    }
    body.baseFee = baseFee;
  }
  if (usesPerKilometre(draft.pricingModel)) {
    const pricePerKilometre = moneyValue(draft.pricePerKilometre, true);
    if (!pricePerKilometre) {
      return { error: 'Enter the price per kilometre in dollars and cents. Zero is allowed.' };
    }
    body.pricePerKilometre = pricePerKilometre;
  }
  if (draft.pricingModel === 'INCLUDED_DISTANCE') {
    const includedMetres = metresFromKilometres(draft.includedKilometres);
    if (includedMetres === null) {
      return { error: 'Enter the included distance in kilometres. Use up to three decimal places.' };
    }
    if (includedMetres < minimumTripMetres || includedMetres > maximumTripMetres) {
      return { error: 'Included distance must be inside the minimum and maximum trip.' };
    }
    body.includedMetres = includedMetres;
  }
  if (draft.pricingModel === 'DISTANCE_TIERS') {
    const tiers = tierBody(draft.tiers, maximumTripMetres);
    if ('error' in tiers) {
      return tiers;
    }
    body.tiers = tiers.tiers;
  }
  const windows = windowBody(draft.windows);
  if ('error' in windows) {
    return windows;
  }
  body.windows = windows.windows;
  return { body };
}

export function matchesSavedWindow(window: WindowDraft, saved: PricingWindow): boolean {
  const basisPoints = basisPointsFromPercent(window.percent);
  if (basisPoints === null || basisPoints !== saved.adjustmentBasisPoints) {
    return false;
  }
  if (window.kind !== saved.kind || window.startsAt !== saved.startsAt || window.endsAt !== saved.endsAt) {
    return false;
  }
  const days = new Set(window.daysOfWeek);
  return saved.daysOfWeek.length === days.size && saved.daysOfWeek.every((day) => days.has(day));
}

export function hasUnsavedEdits(draft: ClassDraft, tariff: ClassTariff | null): boolean {
  if (!tariff) {
    return draft.pricingModel !== ''
      || draft.baseFee !== ''
      || draft.pricePerKilometre !== ''
      || draft.includedKilometres !== ''
      || draft.minimumTripMetres !== ''
      || draft.maximumTripMetres !== ''
      || draft.tiers.length > 0
      || draft.windows.length > 0;
  }
  const saved = reviewClassTariff(draftFromTariff(tariff));
  const current = reviewClassTariff(draft);
  if ('error' in saved || 'error' in current) {
    return true;
  }
  return JSON.stringify(saved.body) !== JSON.stringify(current.body);
}

export function overlapWarnings(windows: WindowDraft[]): string[] {
  const warnings: string[] = [];
  for (let left = 0; left < windows.length; left += 1) {
    for (let right = left + 1; right < windows.length; right += 1) {
      const first = windows[left];
      const second = windows[right];
      if (!first || !second || !schedulesOverlap(first, second)) {
        continue;
      }
      warnings.push(`${first.startsAt}–${first.endsAt} overlaps ${second.startsAt}–${second.endsAt}. The higher-priority window is used for the shared time. The times stay as entered.`);
    }
  }
  return warnings;
}

export function schedulesOverlap(left: WindowDraft, right: WindowDraft): boolean {
  if (clockMinutes(left.startsAt) === null || clockMinutes(left.endsAt) === null) {
    return false;
  }
  if (clockMinutes(right.startsAt) === null || clockMinutes(right.endsAt) === null) {
    return false;
  }
  if (left.daysOfWeek.length === 0 || right.daysOfWeek.length === 0) {
    return false;
  }
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      if (covers(left, weekday, minute) && covers(right, weekday, minute)) {
        return true;
      }
    }
  }
  return false;
}

function covers(window: WindowDraft, weekday: number, minute: number): boolean {
  const start = clockMinutes(window.startsAt);
  const end = clockMinutes(window.endsAt);
  if (start === null || end === null) {
    return false;
  }
  const days = new Set(window.daysOfWeek);
  if (start < end) {
    return days.has(weekday) && minute >= start && minute < end;
  }
  const yesterday = weekday === 1 ? 7 : weekday - 1;
  const startedToday = minute >= start && days.has(weekday);
  const stillOpenFromYesterday = minute < end && days.has(yesterday);
  return startedToday || stillOpenFromYesterday;
}

function tierBody(tiers: TierDraft[], maximumTripMetres: number): { tiers: NonNullable<ClassPublishBody['tiers']> } | { error: string } {
  if (tiers.length === 0) {
    return { error: 'Enter the distance tiers.' };
  }
  let previous = 0;
  const body: NonNullable<ClassPublishBody['tiers']> = [];
  for (const [index, tier] of tiers.entries()) {
    const upToMetres = wholeMetres(tier.upToMetres);
    const amount = moneyValue(tier.amount, true);
    if (upToMetres === null) {
      return { error: 'Enter the tier boundary.' };
    }
    if (!amount) {
      return { error: 'Enter the tier amount in dollars and cents. Zero is allowed.' };
    }
    if (upToMetres <= previous) {
      return { error: 'Tier boundaries must increase so each slice follows the previous one.' };
    }
    if (upToMetres > maximumTripMetres) {
      return { error: 'A tier cannot extend past the maximum trip distance.' };
    }
    body.push({ position: index + 1, upToMetres, amount });
    previous = upToMetres;
  }
  if (previous !== maximumTripMetres) {
    return { error: 'The last tier must end at the maximum trip distance.' };
  }
  return { tiers: body };
}

function windowBody(windows: WindowDraft[]): { windows: ClassPublishWindow[] } | { error: string } {
  const body: ClassPublishWindow[] = [];
  for (const window of windows) {
    if (window.kind !== 'PEAK' && window.kind !== 'OFF_PEAK' && window.kind !== 'NIGHT') {
      return { error: 'Choose a pricing window.' };
    }
    const daysOfWeek = orderedDays(window.daysOfWeek);
    if (daysOfWeek.length === 0) {
      return { error: 'Enter the window days.' };
    }
    if (clockMinutes(window.startsAt) === null || clockMinutes(window.endsAt) === null) {
      return { error: 'Enter the window time as HH:MM.' };
    }
    const adjustmentBasisPoints = basisPointsFromPercent(window.percent);
    if (adjustmentBasisPoints === null) {
      return { error: 'Enter the percentage adjustment. Use up to two decimal places.' };
    }
    body.push({
      kind: window.kind,
      enabled: window.enabled,
      daysOfWeek,
      startsAt: window.startsAt.trim(),
      endsAt: window.endsAt.trim(),
      adjustmentBasisPoints,
    });
  }
  return { windows: body };
}

function orderedDays(days: number[]): number[] {
  const selected = new Set(days);
  return WEEKDAYS.map((day) => day.value).filter((day) => selected.has(day));
}
