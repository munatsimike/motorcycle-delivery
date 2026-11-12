import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useMemo } from 'react';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import type { Palette } from '../theme';
import { radius, spacing, useAppearance } from '../theme';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  icon?: ComponentProps<typeof MaterialDesignIcons>['name'];
  trailingIcon?: ComponentProps<typeof MaterialDesignIcons>['name'];
  iconRotation?: number;
  compact?: boolean;
  align?: 'end' | 'center';
  labelStyle?: StyleProp<TextStyle>;
};

export default function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  loadingLabel,
  icon,
  trailingIcon,
  iconRotation = 0,
  compact = false,
  align = 'end',
  labelStyle,
}: PrimaryButtonProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
      hitSlop={compact ? { top: 2, bottom: 2 } : undefined}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        align === 'center' && styles.centered,
        inactive && styles.inactive,
        pressed && !inactive && styles.pressed,
      ]}
    >
      {loading ? (
        <View style={styles.loadingContent}>
          <ActivityIndicator color={colors.textInverse} />
          {loadingLabel ? <Text style={[styles.label, labelStyle]}>{loadingLabel}</Text> : null}
        </View>
      ) : icon ? (
        <View style={styles.loadingContent}>
          <View style={styles.leadingIcon}>
            <MaterialDesignIcons
              name={icon}
              color={colors.textInverse}
              size={22}
              style={iconRotation ? { transform: [{ rotate: `${iconRotation}deg` }] } : undefined}
            />
          </View>
          <Text style={[styles.label, labelStyle]}>{label}</Text>
        </View>
      ) : (
        <Text style={[styles.label, labelStyle]}>{label}</Text>
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

function createStyles(colors: Palette) {
  return StyleSheet.create({
  button: {
    minHeight: 56,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  compact: {
    minHeight: 44,
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.lg,
  },
  centered: {
    alignSelf: 'center',
  },
  inactive: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.8,
  },
  leadingIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 16,
    fontWeight: '600',
  },
});
}
