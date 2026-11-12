import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

type SecondaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'danger';
  icon?: ComponentProps<typeof MaterialDesignIcons>['name'];
  soft?: boolean;
  bordered?: boolean;
  compact?: boolean;
  weight?: 'bold' | 'regular';
};

export default function SecondaryButton({
  label,
  onPress,
  disabled,
  loading,
  tone = 'primary',
  icon,
  bordered = true,
  compact = false,
  weight = 'bold',
}: SecondaryButtonProps) {
  const inactive = disabled || loading;
  const accent = tone === 'danger' ? colors.error : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        compact && styles.compact,
        inactive && styles.inactive,
        pressed && !inactive && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.button,
          compact && styles.compactButton,
          bordered ? { borderColor: accent, borderWidth: 1 } : styles.borderless,
          { backgroundColor: colors.background },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={accent} />
        ) : (
          <View style={styles.content}>
            {icon ? <MaterialDesignIcons name={icon} color={accent} size={20} /> : null}
            <Text style={[styles.label, weight === 'regular' && styles.labelRegular, { color: accent }]}>{label}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  compact: {
    alignSelf: 'flex-end',
  },
  compactButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  borderless: {
    borderWidth: 0,
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
    fontSize: 16,
    fontWeight: '600',
  },
  labelRegular: {
    fontWeight: '400',
  },
});
