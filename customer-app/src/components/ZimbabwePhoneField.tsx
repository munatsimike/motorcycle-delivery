import { Image, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { useInputFocus } from './useInputFocus';

type ZimbabwePhoneFieldProps = {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
};

export default function ZimbabwePhoneField({
  label = 'Mobile number',
  value,
  onChangeText,
  editable = true,
}: ZimbabwePhoneFieldProps) {
  const focus = useInputFocus();

  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputContainer, focus.style]}>
        <View style={styles.countryCode}>
          <Image
            source={require('../../assets/zimbabwe-flag.png')}
            style={styles.flag}
            resizeMode="cover"
          />
          <Text style={styles.countryCodeText}>+263</Text>
        </View>
        <View style={styles.inputDivider} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder="771234567"
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={16}
          editable={editable}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
        />
      </View>
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
    marginBottom: spacing.md,
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flag: {
    width: 28,
    height: 22,
    borderRadius: 2,
  },
  countryCodeText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  inputDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    fontSize: typography.button,
    color: colors.text,
    paddingVertical: spacing.md,
  },
});
