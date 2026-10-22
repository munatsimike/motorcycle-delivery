import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../../../theme';

type OfflineDeliveriesNoticeProps = {
  message: string;
  onRetry?: () => void;
};

export default function OfflineDeliveriesNotice({ message }: OfflineDeliveriesNoticeProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Connection unavailable</Text>
      <Text style={styles.body}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
