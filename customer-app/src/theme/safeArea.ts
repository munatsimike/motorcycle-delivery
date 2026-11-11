import { spacing } from './spacing';

/** Space between the last visible content and the bottom safe area. */
export const contentAboveSafeArea = spacing.lg;

/** Bottom padding for a delivery surface. Apply once; do not add another safe-area inset outside it. */
export function bottomContentInset(safeBottom: number): number {
  return contentAboveSafeArea + Math.max(0, safeBottom);
}
