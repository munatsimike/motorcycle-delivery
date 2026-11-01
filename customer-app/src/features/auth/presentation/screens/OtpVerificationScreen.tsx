import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import OtpCodeBoxes from '../components/OtpCodeBoxes';
import SecondaryButton from '../../../../components/SecondaryButton';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, spacing, typography } from '../../../../theme';
import { clearRegistrationRecovery, loadRegistrationDraft, rememberRegistrationDraft, rememberRegistrationProof } from '../../data/registrationRecoveryStore';
import { formSeed } from '../../domain/registrationRecovery';
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
    if (result.destination === 'registration') {
      const draft = formSeed(await loadRegistrationDraft().catch(() => ({ fullName: '', address: '' })), {
        fullName: result.fullName,
        address: result.address,
      });
      try {
        await rememberRegistrationProof(result.registrationToken);
        await rememberRegistrationDraft(draft);
      } catch {
        // This visit can still finish. A restart asks for a new code.
      }
      navigation.navigate('CompleteRegistration', {
        registrationToken: result.registrationToken,
        fullName: draft.fullName || undefined,
        address: draft.address || undefined,
      });
      setSubmitted(false);
      return;
    }
    if (result.destination === 'sign_in') {
      navigation.navigate('SignIn', { notice: 'This number already has an account. Sign in to continue.' });
      return;
    }
    try {
      await saveSession(result.session);
      await clearRegistrationRecovery();
    } catch {
      setSaveError('The session could not be saved on this phone.');
      setSubmitted(false);
    }
  }

  const resendLabel = secondsRemaining > 0
    ? `Send another code in ${secondsRemaining}s`
    : 'Send another code';
  const headerHeight = useHeaderHeight();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Verify your number</Text>
        <Text style={styles.subtitle}>
          {`Enter the WhatsApp code sent to ${phone}.`}
        </Text>
        <OtpCodeBoxes
          value={code}
          onChangeText={setCode}
          editable={!isLoading}
          invalid={Boolean(saveError ?? error)}
        />
        <ErrorMessage message={saveError ?? error} />
        <PrimaryButton
          label="Verify"
          trailingIcon="chevron-right"
          onPress={() => {
            void handleVerify();
          }}
          loading={isLoading}
          disabled={submitted}
        />
        <View style={styles.resend}>
          <SecondaryButton
            label={resendLabel}
            icon="refresh"
            bordered={false}
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
    paddingHorizontal: spacing.lg,
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
