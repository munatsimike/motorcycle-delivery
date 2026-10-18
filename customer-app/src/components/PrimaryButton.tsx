import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  icon?: ComponentProps<typeof MaterialDesignIcons>['name'];
  trailingIcon?: ComponentProps<typeof MaterialDesignIcons>['name'];
};

export default function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  loadingLabel,
  icon,
  trailingIcon,
}: PrimaryButtonProps) {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        inactive && styles.inactive,
        pressed && !inactive && styles.pressed,
      ]}
    >
      {loading ? (
        <View style={styles.loadingContent}>
          <ActivityIndicator color={colors.textInverse} />
          {loadingLabel ? <Text style={styles.label}>{loadingLabel}</Text> : null}
        </View>
      ) : icon ? (
        <View style={styles.loadingContent}>
          <MaterialDesignIcons name={icon} color={colors.textInverse} size={22} />
          <Text style={styles.label}>{label}</Text>
        </View>
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
      {!loading && trailingIcon ? (
        <MaterialDesignIcons
          name={trailingIcon}
          color={colors.textInverse}
          size={22}
          style={styles.trailing}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    backgroundColor: colors.primary,
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
  loadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  trailing: {
    position: 'absolute',
    right: spacing.lg,
  },
  label: {
    color: colors.textInverse,
    fontSize: typography.button,
    fontWeight: '700',
  },
});
