import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import FormInput from '../../components/FormInput';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';
import { authEntryActions } from './domain/whatsappRelease';
import PhoneEntryForm from './presentation/components/PhoneEntryForm';
import { useSignUp } from './presentation/viewmodels/useSignUp';

type SignUpProps = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation }: SignUpProps) {
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [passwordMode, setPasswordMode] = useState(false);
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const { isLoading, error, requestCode, startWhatsAppRegistration } = useSignUp();
  const whatsappRegistration = authEntryActions().whatsappRegistration;
  const showWhatsApp = whatsappRegistration && passwordMode;

  async function handleContinue() {
    const normalized = await requestCode(phone);
    if (!normalized) {
      return;
    }
    navigation.navigate('OtpVerification', { phone: normalized, flow: 'registration' });
  }

  async function handlePassword() {
    const verifiedPhone = await startWhatsAppRegistration({
      phone,
      password,
      fullName,
      address,
      whatsappConsent,
    });
    if (!verifiedPhone) {
      return;
    }
    navigation.navigate('OtpVerification', { phone: verifiedPhone, flow: 'whatsapp_registration' });
  }

  return (
    <PhoneEntryForm
      title="Create your account"
      subtitle={showWhatsApp
        ? 'Create an individual account with your phone number and a password. We send one WhatsApp code before the account can sign in.'
        : 'Join Riders and enjoy fast, safe, and reliable motorcycle deliveries.'}
      buttonLabel={showWhatsApp ? 'Create account' : 'Verify'}
      trailingIcon="chevron-right"
      isLoading={isLoading}
      error={error}
      phone={phone}
      onChangePhone={setPhone}
      onSubmit={() => {
        if (showWhatsApp) {
          void handlePassword();
          return;
        }
        void handleContinue();
      }}
      helperText={showWhatsApp ? null : undefined}
      extra={showWhatsApp ? (
        <>
          <FormInput label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" editable={!isLoading} />
          <FormInput label="Address" value={address} onChangeText={setAddress} autoCapitalize="sentences" editable={!isLoading} />
          <FormInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="12 or more characters"
            autoCapitalize="none"
            secureTextEntry
            editable={!isLoading}
          />
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: whatsappConsent }}
            disabled={isLoading}
            onPress={() => setWhatsappConsent((current) => !current)}
            style={styles.consent}
          >
            <Switch
              value={whatsappConsent}
              onValueChange={setWhatsappConsent}
              disabled={isLoading}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
            <Text style={styles.consentText}>I agree to receive WhatsApp authentication messages.</Text>
          </Pressable>
        </>
      ) : null}
      secondaryLabel={whatsappRegistration ? (passwordMode ? 'Use a one-time code' : 'Create account with a password') : undefined}
      onSecondary={whatsappRegistration ? () => setPasswordMode((current) => !current) : undefined}
      footerText="Already have an account?"
      footerAction="Sign In"
      onFooterPress={() => navigation.navigate('SignIn')}
    />
  );
}

const styles = StyleSheet.create({
  consent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  consentText: {
    flex: 1,
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.text,
  },
});
