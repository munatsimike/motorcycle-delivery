import { StyleSheet, Text, TextInput, type KeyboardTypeOptions } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { useInputFocus } from './useInputFocus';

type FormInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: 'tel' | 'sms-otp' | 'name' | 'email' | 'off';
  textContentType?: 'telephoneNumber' | 'oneTimeCode' | 'name' | 'emailAddress' | 'fullStreetAddress' | 'none';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  editable?: boolean;
  error?: string | null;
  onFocus?: () => void;
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
  maxLength,
  editable = true,
  error,
  onFocus,
}: FormInputProps) {
  const focus = useInputFocus();

  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, focus.style, !editable && styles.locked]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        maxLength={maxLength}
        editable={editable}
        onFocus={() => {
          focus.onFocus();
          onFocus?.();
        }}
        onBlur={focus.onBlur}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
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
});
