import { useState } from 'react';

import { inputFocusStyle } from '../theme';

export function useInputFocus() {
  const [focused, setFocused] = useState(false);

  return {
    style: focused ? inputFocusStyle : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
