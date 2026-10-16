import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import LoadingIndicator from '../../../../components/LoadingIndicator';
import { colors, radius, spacing, typography } from '../../../../theme';
import { nearbyActionLabel, nearbyCardContent, type NearbyCardContent } from '../../domain/nearbyCard';
import type { NearbyAvailability } from '../../domain/nearbyAvailability';

type NearbyRidersCardProps = {
  state: NearbyAvailability;
  onTurnOnLocation: () => void;
  onAllowLocation: () => void;
  onTryAgain: () => void;
  embedded?: boolean;
};

const TONES = {
  amber: { background: '#FFF4E5', color: '#C56A12' },
  neutral: { background: '#EEF2F6', color: '#475569' },
  green: { background: colors.primaryLight, color: colors.primaryDark },
  danger: { background: '#FDECEC', color: colors.error },
} as const;

export default function NearbyRidersCard({
  state,
  onTurnOnLocation,
  onAllowLocation,
  onTryAgain,
  embedded = false,
}: NearbyRidersCardProps) {
  if (state.status === 'loading') {
    return (
      <View style={[styles.card, embedded && styles.embedded]}>
        <LoadingIndicator />
      </View>
    );
  }

  const content = nearbyCardContent(state);
  if (!content) {
    return null;
  }
  const tone = TONES[content.tone];
  const action = nearbyActionLabel(content.action);

  return (
    <View style={[styles.card, embedded && styles.embedded]}>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: tone.background }]}>
          <MaterialDesignIcons name={content.icon} color={tone.color} size={20} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{content.title}</Text>
          {content.message ? <Text style={styles.message}>{content.message}</Text> : null}
          {action ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => pressAction(content.action, onTurnOnLocation, onAllowLocation, onTryAgain)}
              style={styles.button}
            >
              <Text style={styles.buttonLabel}>{action}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function pressAction(
  action: NearbyCardContent['action'],
  onTurnOnLocation: () => void,
  onAllowLocation: () => void,
  onTryAgain: () => void,
) {
  if (action === 'turn-on-location') {
    onTurnOnLocation();
    return;
  }
  if (action === 'allow-location') {
    onAllowLocation();
    return;
  }
  if (action === 'try-again') {
    onTryAgain();
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8FAF9',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0 4px 16px rgba(23, 33, 29, 0.08)',
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  embedded: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    boxShadow: 'none',
    marginBottom: 0,
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.text,
  },
  message: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  button: {
    alignSelf: 'flex-start',
    minHeight: 36,
    marginTop: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(22, 155, 98, 0.35)',
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
});
