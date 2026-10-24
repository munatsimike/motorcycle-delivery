import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../../../navigation/types';
import { colors, spacing, typography } from '../../../../theme';
import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import { normalizePhone } from '../../domain/normalizePhone';
import PhoneEntryForm from '../components/PhoneEntryForm';
import { errorMessage } from '../errorMessage';

type ForgotPasswordProps = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

export default function ForgotPasswordScreen({ navigation }: ForgotPasswordProps) {
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (isLoading) {
      return;
    }
    if (!consent) {
      setError('Consent to WhatsApp authentication messages is required');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const normalized = normalizePhone(phone);
      await customerAuthRepository.requestPasswordReset(normalized);
      navigation.navigate('ResetPassword', { phone: normalized });
    } catch (caught) {
      setError(errorMessage(caught, 'A recovery code could not be requested.'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <PhoneEntryForm
      title="Forgot password"
      subtitle="If this number has a verified account, we'll send a WhatsApp code. Unverified numbers are not reset."
      buttonLabel="Send code"
      trailingIcon="chevron-right"
      isLoading={isLoading}
      error={error}
      phone={phone}
      onChangePhone={setPhone}
      onSubmit={() => {
        void handleSubmit();
      }}
      extra={(
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: consent }}
          disabled={isLoading}
          onPress={() => setConsent((current) => !current)}
          style={styles.consent}
        >
          <Switch
            value={consent}
            onValueChange={setConsent}
            disabled={isLoading}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
          <Text style={styles.consentText}>I agree to receive a WhatsApp authentication message.</Text>
        </Pressable>
      )}
      footerText="Remembered it?"
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
