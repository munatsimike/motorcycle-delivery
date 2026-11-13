export type Palette = {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  background: string;
  surface: string;
  canvas: string;
  sheet: string;
  text: string;
  textSecondary: string;
  textInverse: string;
  border: string;
  listBackground: string;
  listCardBorder: string;
  error: string;
  offer: string;
  offerSurface: string;
  noRider: string;
  noRiderSurface: string;
};

export const lightColors: Palette = {
  primary: '#169B62',
  primaryDark: '#087A4A',
  primaryLight: '#E9F8EF',
  background: '#FFFFFF',
  surface: '#F1FAF5',
  canvas: '#F7FCF9',
  sheet: '#FFFFFF',
  text: '#17211D',
  textSecondary: '#8A9690',
  textInverse: '#FFFFFF',
  border: '#E1E8E3',
  /** Deliveries list page, matching the rider bids screen. */
  listBackground: '#F3F8F5',
  listCardBorder: '#E1E9E4',
  error: '#D92D20',
  offer: '#7C3AED',
  offerSurface: '#F3E8FF',
  noRider: '#D97706',
  noRiderSurface: '#FFF3DF',
};

export const darkColors: Palette = {
  primary: '#169B62',
  primaryDark: '#087A4A',
  primaryLight: '#16352A',
  background: '#101614',
  surface: '#1A2420',
  canvas: '#101614',
  sheet: '#17211D',
  text: '#F3F7F5',
  textSecondary: '#9AABA3',
  textInverse: '#FFFFFF',
  border: '#2C3A34',
  listBackground: '#141C19',
  listCardBorder: '#2C3A34',
  error: '#F97066',
  offer: '#C4B5FD',
  offerSurface: '#2E1B47',
  noRider: '#FBBF24',
  noRiderSurface: '#422C12',
};

/** Light palette. React screens should read `useAppearance().colors` so theme changes repaint. */
export const colors = lightColors;
