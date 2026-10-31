import { StyleSheet, Text } from 'react-native';

import { colors, spacing, typography } from '../theme';
import { isNetworkUnavailableMessage, useNetworkNotice } from './NetworkNotice';

type ErrorMessageProps = {
  message: string | null;
};

export default function ErrorMessage({ message }: ErrorMessageProps) {
  const network = message != null && isNetworkUnavailableMessage(message);
  useNetworkNotice(network);
  if (!message || network) {
    return null;
  }

  return <Text style={styles.message}>{message}</Text>;
}

const styles = StyleSheet.create({
  message: {
    color: colors.error,
    fontSize: typography.caption,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
});
