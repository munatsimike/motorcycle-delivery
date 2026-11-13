import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { Palette } from '../theme';
import { useAppearance, spacing, typography } from '../theme';
import { isNetworkUnavailableMessage, useNetworkNotice } from './NetworkNotice';

type ErrorMessageProps = {
  message: string | null;
};

export default function ErrorMessage({ message }: ErrorMessageProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const network = message != null && isNetworkUnavailableMessage(message);
  useNetworkNotice(network);
  if (!message || network) {
    return null;
  }

  return <Text style={styles.message}>{message}</Text>;
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  message: {
    color: colors.error,
    fontSize: typography.caption,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
});
}
