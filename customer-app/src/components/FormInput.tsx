import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import type { Palette } from '../theme';
import { inputErrorStyle, radius, spacing, typography, useAppearance } from '../theme';
import { useRevealFocusedField } from './useKeyboardLift';
import { useInputFocus } from './useInputFocus';

type FormInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: 'tel' | 'sms-otp' | 'name' | 'email' | 'off' | 'password';
  textContentType?: 'telephoneNumber' | 'oneTimeCode' | 'name' | 'emailAddress' | 'fullStreetAddress' | 'none' | 'password';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
  maxLength?: number;
  editable?: boolean;
  error?: string | null;
  invalid?: boolean;
  onFocus?: () => void;
  /** Shown inside an empty field. The field stays editable. */
  activity?: string | null;
};

export default function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoComplete,
  textContentType,
  autoCapitalize,
  secureTextEntry,
  maxLength,
  editable = true,
  error,
  invalid = false,
  onFocus,
  activity = null,
}: FormInputProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const focus = useInputFocus();
  const revealFocusedField = useRevealFocusedField();

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View>
        <TextInput
          style={[styles.input, focus.style, (error || invalid) ? inputErrorStyle(colors.error) : null, !editable && styles.locked]}
          value={value}
          onChangeText={onChangeText}
          placeholder={activity && !value ? undefined : placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={secureTextEntry ? 'password' : autoComplete}
          textContentType={secureTextEntry ? 'password' : textContentType}
          secureTextEntry={secureTextEntry}
          maxLength={maxLength}
          editable={editable}
          onFocus={() => {
            focus.onFocus();
            revealFocusedField();
            onFocus?.();
          }}
          onBlur={focus.onBlur}
        />
        {activity && !value ? (
          <View pointerEvents="none" style={styles.activity}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.activityText}>{activity}</Text>
          </View>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  label: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  input: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    fontSize: typography.button,
    color: colors.text,
    backgroundColor: colors.background,
    marginBottom: spacing.md,
  },
  locked: {
    backgroundColor: colors.surface,
    color: colors.textSecondary,
  },
  error: {
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.error,
  },
  activity: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: 0,
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activityText: {
    flex: 1,
    fontSize: typography.button,
    color: colors.textSecondary,
  },
});
}
