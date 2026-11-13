import type { ViewStyle } from 'react-native';

import { colors } from './colors';

export const inputFocusStyle: ViewStyle = {
  borderWidth: 2,
  borderColor: colors.primary,
  boxShadow: '0 0 0 4px rgba(22, 155, 98, 0.22)',
};

export const inputErrorStyle: ViewStyle = {
  borderWidth: 2,
  borderColor: colors.error,
  boxShadow: '0 0 0 4px rgba(217, 45, 32, 0.22)',
};
