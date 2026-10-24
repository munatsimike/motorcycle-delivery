import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import FormInput from '../../../../components/FormInput';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, spacing, typography } from '../../../../theme';
import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import { isVerificationCode } from '../../domain/verificationCode';
import { useSession } from '../viewmodels/useSession';
import { errorMessage } from '../errorMessage';

type ResetPasswordProps = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>;

export default function ResetPasswordScreen({ navigation, route }: ResetPasswordProps) {
  const { phone } = route.params;
  const { logout } = useSession();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headerHeight = useHeaderHeight();

  async function handleReset() {
    if (isLoading) {
      return;
    }
    if (!isVerificationCode(code)) {
      setError('Enter the WhatsApp code.');
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setError('Password must contain 12 to 128 characters');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await customerAuthRepository.resetPassword(phone, code, password);
      await logout();
      navigation.navigate('SignIn', { notice: 'Password updated. Sign in with your new password.' });
    } catch (caught) {
      setError(errorMessage(caught, 'The password could not be reset.'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>
          Enter the WhatsApp code for {phone}. You will need to sign in again. Saved sessions on other phones are signed out.
        </Text>
        <FormInput
          label="WhatsApp code"
          value={code}
          onChangeText={setCode}
          placeholder="Enter code"
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={10}
          editable={!isLoading}
        />
        <FormInput
          label="New password"
          value={password}
          onChangeText={setPassword}
          placeholder="12 or more characters"
          autoCapitalize="none"
          secureTextEntry
          editable={!isLoading}
        />
        <ErrorMessage message={error} />
        <PrimaryButton
          label="Reset password"
          trailingIcon="chevron-right"
          onPress={() => {
            void handleReset();
          }}
          loading={isLoading}
        />
        <SecondaryButton
          label="Send another code"
          icon="refresh"
          onPress={() => {
            navigation.navigate('ForgotPassword');
          }}
          disabled={isLoading}
        />
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
    gap: spacing.md,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
});
