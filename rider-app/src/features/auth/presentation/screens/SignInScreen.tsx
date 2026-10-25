import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../../../navigation/types';
import AuthForm from '../components/AuthForm';
import { useSignIn } from '../viewmodels/useSignIn';

type SignInProps = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation }: SignInProps) {
  const [phone, setPhone] = useState('');
  const { isLoading, error, requestCode } = useSignIn();

  async function handleContinue() {
    const normalized = await requestCode(phone);
    if (!normalized) {
      return;
    }
    navigation.navigate('OtpVerification', { phone: normalized, flow: 'login' });
  }

  return (
    <AuthForm
      title="Welcome back"
      subtitle="We'll send a one-time WhatsApp code to this number."
      buttonLabel="Send code"
      isLoading={isLoading}
      error={error}
      phone={phone}
      onChangePhone={setPhone}
      onSubmit={() => {
        void handleContinue();
      }}
      helperText="We'll send a one-time WhatsApp code to this Zimbabwe number."
      footerText="New rider?"
      footerAction="Create an account"
      onFooterPress={() => navigation.navigate('SignUp')}
    />
  );
}
