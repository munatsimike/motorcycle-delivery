import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../../../theme';
import { fitOtpDigits, OTP_BOX_COUNT } from '../../domain/verificationCode';

type OtpCodeBoxesProps = {
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  invalid?: boolean;
};

export default function OtpCodeBoxes({ value, onChangeText, editable = true, invalid = false }: OtpCodeBoxesProps) {
  const inputRef = useRef<TextInput>(null);
  const digits = fitOtpDigits(value);
  const activeIndex = Math.min(digits.length, OTP_BOX_COUNT - 1);

  return (
    <Pressable
      accessibilityRole="none"
      onPress={() => inputRef.current?.focus()}
      style={styles.field}
    >
      <View pointerEvents="none" style={styles.boxes}>
        {Array.from({ length: OTP_BOX_COUNT }, (_, index) => {
          const filled = index < digits.length;
          const active = editable && index === activeIndex && digits.length < OTP_BOX_COUNT;
          return (
            <View
              key={index}
              style={[
                styles.box,
                filled && styles.boxFilled,
                active && styles.boxActive,
                invalid && styles.boxInvalid,
              ]}
            >
              <Text style={styles.digit}>{digits[index] ?? ''}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        accessibilityLabel="Verification code"
        value={digits}
        onChangeText={(next) => onChangeText(fitOtpDigits(next))}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        importantForAutofill="yes"
        autoFocus
        autoCorrect={false}
        spellCheck={false}
        caretHidden
        maxLength={OTP_BOX_COUNT}
        editable={editable}
        underlineColorAndroid="transparent"
        style={styles.capture}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    position: 'relative',
    height: 48,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  boxes: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: 48,
  },
  box: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: {
    borderColor: colors.primary,
  },
  boxActive: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  boxInvalid: {
    borderWidth: 2,
    borderColor: colors.error,
  },
  digit: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  capture: {
    ...StyleSheet.absoluteFill,
    opacity: 0,
    color: 'transparent',
  },
});
