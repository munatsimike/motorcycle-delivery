import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation/types';
import PhoneEntryForm from './presentation/components/PhoneEntryForm';
import { useSignUp } from './presentation/viewmodels/useSignUp';

type SignUpProps = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation, route }: SignUpProps) {
  const [phone, setPhone] = useState('');
  const { isLoading, error, startWhatsAppRegistration } = useSignUp();

  async function handleSubmit() {
    const verifiedPhone = await startWhatsAppRegistration(phone);
    if (!verifiedPhone) {
      return;
    }
    navigation.navigate('OtpVerification', { phone: verifiedPhone, flow: 'whatsapp_registration' });
  }

  return (
    <PhoneEntryForm
      title="Create your account"
      subtitle="Enter your Zimbabwe WhatsApp number. We'll send a code before asking for your details."
      buttonLabel="Send code"
      trailingIcon="chevron-right"
      isLoading={isLoading}
      error={error ?? route.params?.notice ?? null}
      phone={phone}
      onChangePhone={setPhone}
      onSubmit={() => {
        void handleSubmit();
      }}
      helperText="Enter a Zimbabwe mobile number. We'll send a one-time WhatsApp code."
      footerText="Already have an account?"
      footerAction="Sign In"
      onFooterPress={() => navigation.navigate('SignIn')}
    />
  );
}
