import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import FormInput from '../../../../components/FormInput';
import { colors, spacing, typography } from '../../../../theme';
import type { RootStackParamList } from '../../../../navigation/types';
import { authEntryActions } from '../../domain/whatsappRelease';
import PhoneEntryForm from '../components/PhoneEntryForm';
import { useSession } from '../viewmodels/useSession';
import { useSignIn } from '../viewmodels/useSignIn';

const MISSING_ACCOUNT = 'You don\'t have a customer account for this phone number. If you already have a Riders rider account, you can use the same number to register as a customer.';

type SignInProps = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation, route }: SignInProps) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [accountMissing, setAccountMissing] = useState(false);
  const { isLoading, error, requestCode, loginWithPassword } = useSignIn();
  const passwordRecovery = authEntryActions().passwordRecovery;
  const { saveSession } = useSession();

  async function handleContinue() {
    const result = await requestCode(phone);
    if (!result) {
      return;
    }
    if (result.status === 'unavailable') {
      setAccountMissing(true);
      return;
    }
    setAccountMissing(false);
    navigation.navigate('OtpVerification', { phone: result.phone, flow: 'login' });
  }

  async function handlePassword() {
    const session = await loginWithPassword(phone, password);
    if (!session) {
      return;
    }
    await saveSession(session);
  }

  return (
    <PhoneEntryForm
      title={accountMissing ? 'Customer account not found' : 'Welcome back'}
      subtitle={accountMissing ? MISSING_ACCOUNT : 'Enter your mobile number and we\'ll send a one-time code.'}
      buttonLabel={accountMissing ? 'Create Customer Account' : 'Continue'}
      trailingIcon="chevron-right"
      isLoading={isLoading}
      error={accountMissing ? null : error ?? route.params?.notice ?? null}
      phone={phone}
      onChangePhone={(value) => {
        setPhone(value);
        setAccountMissing(false);
      }}
      onSubmit={() => {
        if (accountMissing) {
          navigation.navigate('SignUp');
          return;
        }
        void handleContinue();
      }}
      helperText={accountMissing ? null : undefined}
      extra={accountMissing ? null : (
        <>
          <FormInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="12 or more characters"
            autoCapitalize="none"
            secureTextEntry
            editable={!isLoading}
          />
          {passwordRecovery ? (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={() => navigation.navigate('ForgotPassword')}
              style={styles.forgot}
            >
              <Text style={styles.forgotText}>Forgot password</Text>
            </Pressable>
          ) : null}
        </>
      )}
      secondaryLabel={accountMissing ? undefined : 'Sign in with password'}
      onSecondary={accountMissing ? undefined : () => {
        void handlePassword();
      }}
      footerText="New to Riders?"
      footerAction="Create account"
      onFooterPress={() => navigation.navigate('SignUp')}
    />
  );
}

const styles = StyleSheet.create({
  forgot: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  forgotText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
