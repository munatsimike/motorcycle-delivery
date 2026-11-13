import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../../../navigation/types';
import PhoneEntryForm from '../components/PhoneEntryForm';
import { useSignIn } from '../viewmodels/useSignIn';

type SignInProps = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation, route }: SignInProps) {
  const [phone, setPhone] = useState('');
  const { isLoading, error, startWhatsAppLogin } = useSignIn();

  async function handleSubmit() {
    const started = await startWhatsAppLogin(phone);
    if (started?.status !== 'pending' || !started.phone) {
      return;
    }
    navigation.navigate('OtpVerification', { phone: started.phone, flow: 'whatsapp_login' });
  }

  return (
    <PhoneEntryForm
      title="Welcome back"
      subtitle="We'll send a one-time WhatsApp code to this number."
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
      footerText="New to Riders?"
      footerAction="Create account"
      onFooterPress={() => navigation.navigate('SignUp')}
    />
  );
}
