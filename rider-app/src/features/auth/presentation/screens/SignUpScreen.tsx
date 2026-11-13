import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../../../navigation/types';
import AuthForm from '../components/AuthForm';
import { useSignUp } from '../viewmodels/useSignUp';

type SignUpProps = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation }: SignUpProps) {
  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const { isLoading, error, requestCode } = useSignUp();

  async function handleContinue() {
    const started = await requestCode(phone, fullName, address);
    if (!started) {
      return;
    }
    navigation.navigate('OtpVerification', {
      phone: started.phone,
      fullName: started.fullName,
      flow: 'registration',
    });
  }

  return (
    <AuthForm
      title="Create your rider account"
      subtitle="We'll send one WhatsApp code to create your rider account."
      buttonLabel="Continue"
      isLoading={isLoading}
      error={error}
      fullName={fullName}
      onChangeFullName={setFullName}
      address={address}
      onChangeAddress={setAddress}
      phone={phone}
      onChangePhone={setPhone}
      onSubmit={() => {
        void handleContinue();
      }}
      footerText="Already registered?"
      footerAction="Sign in"
      onFooterPress={() => navigation.navigate('SignIn')}
    />
  );
}
