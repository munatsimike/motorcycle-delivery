import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

type SecondaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'danger';
  icon?: ComponentProps<typeof MaterialDesignIcons>['name'];
  soft?: boolean;
};

const dangerFill = '#FEF2F2';

export default function SecondaryButton({
  label,
  onPress,
  disabled,
  loading,
  tone = 'primary',
  icon,
  soft = true,
}: SecondaryButtonProps) {
  const inactive = disabled || loading;
  const accent = tone === 'danger' ? colors.error : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        inactive && styles.inactive,
        pressed && !inactive && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.button,
          { borderColor: accent, backgroundColor: tone === 'danger' ? dangerFill : soft ? colors.primaryLight : colors.background },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={accent} />
        ) : (
          <View style={styles.content}>
            {icon ? <MaterialDesignIcons name={icon} color={accent} size={20} /> : null}
            <Text style={[styles.label, { color: accent }]}>{label}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  inactive: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    color: colors.primary,
    fontSize: typography.button,
    fontWeight: '700',
  },
});
