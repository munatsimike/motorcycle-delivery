import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../../../theme';

type OfflineDeliveriesNoticeProps = {
  message: string;
  onRetry?: () => void;
};

export default function OfflineDeliveriesNotice({ message }: OfflineDeliveriesNoticeProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.icon}>
        <MaterialDesignIcons name="cloud-off-outline" size={26} color={colors.error} />
      </View>
      <Text style={styles.title}>No internet connection</Text>
      <Text style={styles.body}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: radius.lg,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8D7D4',
  },
  title: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.error,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.error,
    textAlign: 'center',
  },
});
