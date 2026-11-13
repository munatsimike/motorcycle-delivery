import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Palette } from '../theme';
import { useAppearance, radius, spacing, typography } from '../theme';

type DialogModalProps = {
  visible: boolean;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
  cardStyle?: StyleProp<ViewStyle>;
};

export default function DialogModal({
  visible,
  onClose,
  closeLabel = 'Close',
  children,
  cardStyle,
}: DialogModalProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={styles.scrim}
        />
        <View style={[styles.card, cardStyle]}>{children}</View>
      </View>
    </Modal>
  );
}

export function DialogTitle({ children }: { children: ReactNode }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.title}>{children}</Text>;
}

export function DialogBody({ children }: { children: ReactNode }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.body}>{children}</Text>;
}

export function DialogActions({ children }: { children: ReactNode }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.actions}>{children}</View>;
}

export function DialogTextButton({
  label,
  onPress,
  tone = 'primary',
  disabled,
  loading,
  weight = 'bold',
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'danger' | 'neutral';
  disabled?: boolean;
  loading?: boolean;
  weight?: 'bold' | 'regular';
}) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const toneStyle = tone === 'danger' ? styles.textDanger : tone === 'neutral' ? styles.textNeutral : styles.textPrimary;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.textButton, inactive && styles.inactive, pressed && !inactive && styles.pressed]}
    >
      {loading ? <ActivityIndicator color={toneStyle.color} size="small" /> : null}
      <Text style={[styles.textLabel, toneStyle, weight === 'regular' && styles.textRegular]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(23, 33, 29, 0.4)',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.sheet,
  },
  title: {
    textAlign: 'center',
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    textAlign: 'center',
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  textButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  textLabel: {
    fontSize: typography.button,
    fontWeight: '700',
  },
  textRegular: {
    fontWeight: '400',
  },
  textPrimary: {
    color: colors.primary,
  },
  textNeutral: {
    color: colors.textSecondary,
    fontWeight: '500',
  },
  textDanger: {
    color: colors.error,
  },
  inactive: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.7,
  },
});
}
