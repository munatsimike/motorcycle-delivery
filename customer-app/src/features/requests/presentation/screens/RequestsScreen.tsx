import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../../../../theme';

export default function RequestsScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>Requests</Text>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No delivery requests yet</Text>
        <Text style={styles.emptyBody}>
          When you request a delivery, it will appear here.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.xl,
  },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  emptyTitle: {
    fontSize: typography.heading,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    fontSize: typography.body,
    lineHeight: 24,
    color: colors.textSecondary,
  },
});
