import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import FormInput from '../../components/FormInput';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';
import { customerDeliveryRepository } from '../deliveries/data/CustomerDeliveryApiRepository';
import { emptyStop, type StopDraft } from '../deliveries/domain/bookingDraft';
import AddressField from '../deliveries/presentation/components/AddressField';
import PhoneEntryForm from './presentation/components/PhoneEntryForm';
import { useSignUp } from './presentation/viewmodels/useSignUp';

type SignUpProps = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation }: SignUpProps) {
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [addressStop, setAddressStop] = useState<StopDraft>(emptyStop);
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const { isLoading, error, startWhatsAppRegistration } = useSignUp();

  async function handleSubmit() {
    const verifiedPhone = await startWhatsAppRegistration({
      phone,
      fullName,
      address: addressStop.address,
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
      subtitle="We'll send one WhatsApp code to create your account."
      buttonLabel="Create account"
      trailingIcon="chevron-right"
      isLoading={isLoading}
      error={error}
      phone={phone}
      onChangePhone={setPhone}
      onSubmit={() => {
        void handleSubmit();
      }}
      helperText={null}
      extra={(
        <>
          <FormInput label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" editable={!isLoading} />
          <AddressField
            stop={addressStop}
            editable={!isLoading}
            showMatchNote={false}
            searchPlaces={(text, sessionToken) => customerDeliveryRepository.searchOpenPlaces(text, sessionToken)}
            resolvePlace={(placeId, sessionToken) => customerDeliveryRepository.resolveOpenPlace(placeId, sessionToken)}
            onChange={(patch) => {
              setAddressStop((current) => ({ ...current, ...patch }));
            }}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: whatsappConsent, disabled: isLoading }}
            disabled={isLoading}
            onPress={() => setWhatsappConsent((current) => !current)}
            style={styles.consent}
          >
            <View style={[styles.checkbox, whatsappConsent ? styles.checkboxChecked : null]}>
              {whatsappConsent ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>I agree to receive WhatsApp authentication messages.</Text>
          </Pressable>
        </>
      )}
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
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
  },
  checkmark: {
    color: colors.textInverse,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  consentText: {
    flex: 1,
    fontSize: typography.small,
    lineHeight: 16,
    color: colors.text,
  },
});
