import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import FormInput from '../../../../components/FormInput';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, spacing, typography } from '../../../../theme';
import { useSession } from '../viewmodels/useSession';
import { useOtpVerification } from '../viewmodels/useOtpVerification';

type OtpProps = NativeStackScreenProps<RootStackParamList, 'OtpVerification'>;

export default function OtpVerificationScreen({ navigation, route }: OtpProps) {
  const { phone, flow } = route.params;
  const { saveSession } = useSession();
  const {
    code,
    setCode,
    isLoading,
    error,
    secondsRemaining,
    verify,
    resend,
  } = useOtpVerification(phone, flow);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleVerify() {
    if (submitted || isLoading) {
      return;
    }
    setSubmitted(true);
    const result = await verify();
    if (!result) {
      setSubmitted(false);
      return;
    }
    if (result.flow === 'registration') {
      navigation.navigate('RegistrationForm', {
        registrationToken: result.proof.registrationToken,
        phone,
      });
      setSubmitted(false);
      return;
    }
    try {
      await saveSession(result.session);
    } catch {
      setSaveError('The session could not be saved on this phone.');
      setSubmitted(false);
    }
  }

  const resendLabel = secondsRemaining > 0
    ? `Send another code in ${secondsRemaining}s`
    : 'Send another code';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Verify your number</Text>
        <Text style={styles.subtitle}>
          Enter the verification code sent to {phone}.
        </Text>
        <FormInput
          label="Verification code"
          value={code}
          onChangeText={setCode}
          placeholder="Enter code"
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={10}
          editable={!isLoading}
        />
        <ErrorMessage message={saveError ?? error} />
        <PrimaryButton
          label="Verify & Continue"
          onPress={() => {
            void handleVerify();
          }}
          loading={isLoading}
          disabled={submitted}
        />
        <View style={styles.resend}>
          <SecondaryButton
            label={resendLabel}
            onPress={() => {
              void resend();
            }}
            disabled={secondsRemaining > 0 || isLoading}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.xxl,
  },
  resend: {
    marginTop: spacing.md,
  },
});
