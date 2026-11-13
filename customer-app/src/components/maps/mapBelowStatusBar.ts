import type { ViewStyle } from 'react-native';

/** Fills the parent from the bottom of the status bar to the parent edges. */
export function mapBelowStatusBar(statusBarInset: number): ViewStyle {
  return {
    position: 'absolute',
    top: Math.max(0, statusBarInset),
    right: 0,
    bottom: 0,
    left: 0,
  };
}
