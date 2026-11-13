import type { RiderSearchView } from '../features/deliveries/domain/riderSearchView';

export const FORWARD_MS = 420;
export const MODAL_MS = 250;
export const TAB_MS = FORWARD_MS;
export const SUGGESTION_MS = 180;
export const PRESS_MS = 120;
export const PRESS_SCALE = 0.985;
export const CONFIRM_MS = 380;
export const STATUS_MS = 180;

export const STACK_ANIMATION = 'slide_from_right' as const;
export const MODAL_ANIMATION = 'fade_from_bottom' as const;
export const TAB_ANIMATION = 'shift' as const;

export function tabSlideOffsets(width: number): [number, number, number] {
  return [-width / 6, 0, width];
}

export function motionDuration(preferred: number, reduceMotion: boolean): number {
  return reduceMotion ? 0 : preferred;
}

export function showsBookingSuccess(backendConfirmed: boolean): boolean {
  return backendConfirmed;
}

export function bookingNavigationDelay(backendConfirmed: boolean, reduceMotion: boolean): number {
  if (!backendConfirmed) {
    return 0;
  }
  return motionDuration(CONFIRM_MS, reduceMotion);
}

export function suggestionListFades(previousCount: number, nextCount: number): boolean {
  return previousCount === 0 && nextCount > 0;
}

export function riderSearchMotionActive(view: RiderSearchView): boolean {
  return view === 'searching';
}
