import { describe, expect, it } from 'vitest';

import {
  bookingNavigationDelay,
  CONFIRM_MS,
  FORWARD_MS,
  MODAL_MS,
  motionDuration,
  PRESS_SCALE,
  riderSearchMotionActive,
  showsBookingSuccess,
  STATUS_MS,
  suggestionListFades,
  TAB_MS,
  tabSlideOffsets,
} from './screenMotion';

describe('customer screen motion', () => {
  it('matches the rider screen slide', () => {
    expect(FORWARD_MS).toBe(420);
    expect(TAB_MS).toBe(FORWARD_MS);
    expect(MODAL_MS).toBeGreaterThanOrEqual(220);
    expect(MODAL_MS).toBeLessThanOrEqual(280);
    expect(tabSlideOffsets(360)).toEqual([-60, 0, 360]);
    expect(CONFIRM_MS).toBeGreaterThanOrEqual(300);
    expect(CONFIRM_MS).toBeLessThanOrEqual(450);
    expect(STATUS_MS).toBeLessThanOrEqual(200);
    expect(PRESS_SCALE).toBeGreaterThanOrEqual(0.97);
    expect(PRESS_SCALE).toBeLessThan(1);
  });

  it('skips motion when reduce motion is on', () => {
    expect(motionDuration(FORWARD_MS, true)).toBe(0);
    expect(motionDuration(FORWARD_MS, false)).toBe(FORWARD_MS);
  });

  it('shows booking success only after the backend confirms', () => {
    expect(showsBookingSuccess(false)).toBe(false);
    expect(showsBookingSuccess(true)).toBe(true);
    expect(bookingNavigationDelay(false, false)).toBe(0);
    expect(bookingNavigationDelay(true, false)).toBe(CONFIRM_MS);
    expect(bookingNavigationDelay(true, true)).toBe(0);
  });

  it('fades address suggestions only when the first results appear', () => {
    expect(suggestionListFades(0, 3)).toBe(true);
    expect(suggestionListFades(2, 4)).toBe(false);
    expect(suggestionListFades(3, 0)).toBe(false);
  });

  it('runs the rider search motion only while searching', () => {
    expect(riderSearchMotionActive('searching')).toBe(true);
    expect(riderSearchMotionActive('assigned')).toBe(false);
    expect(riderSearchMotionActive('no-rider')).toBe(false);
    expect(riderSearchMotionActive('details')).toBe(false);
  });
});
