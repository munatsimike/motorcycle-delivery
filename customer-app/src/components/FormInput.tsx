import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { colors, inputErrorStyle, radius, spacing, typography } from '../theme';
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
}: FormInputProps) {
  const focus = useInputFocus();
  const revealFocusedField = useRevealFocusedField();

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, focus.style, (error || invalid) ? inputErrorStyle : null, !editable && styles.locked]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
