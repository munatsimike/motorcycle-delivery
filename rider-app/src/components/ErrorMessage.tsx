import { StyleSheet, Text } from 'react-native';

import { colors, spacing, typography } from '../theme';

type ErrorMessageProps = {
  message: string | null;
};

export default function ErrorMessage({ message }: ErrorMessageProps) {
  if (!message) {
    return null;
  }

  return (
    <Text accessibilityRole="alert" style={styles.message}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  message: {
    color: colors.error,
    fontSize: typography.caption,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
});
