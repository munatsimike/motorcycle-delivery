import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../../../navigation/types';
import PhoneEntryForm from '../components/PhoneEntryForm';
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
    <PhoneEntryForm
      title="Welcome back"
      subtitle="Enter your mobile number and we'll send a one-time code."
      buttonLabel="Continue"
      trailingIcon="chevron-right"
      isLoading={isLoading}
      error={error}
      phone={phone}
      onChangePhone={setPhone}
      onSubmit={() => {
        void handleContinue();
      }}
      footerText="New to Riders?"
      footerAction="Sign Up"
      onFooterPress={() => navigation.navigate('SignUp')}
    />
  );
}
