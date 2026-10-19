import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation/types';
import PhoneEntryForm from './presentation/components/PhoneEntryForm';
import { useSignUp } from './presentation/viewmodels/useSignUp';

type SignUpProps = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation }: SignUpProps) {
  const [phone, setPhone] = useState('');
  const { isLoading, error, requestCode } = useSignUp();

  async function handleContinue() {
    const normalized = await requestCode(phone);
    if (!normalized) {
      return;
    }
    navigation.navigate('OtpVerification', { phone: normalized, flow: 'registration' });
  }

  return (
    <PhoneEntryForm
      title="Create your account"
      subtitle="Join Riders and enjoy fast, safe, and reliable motorcycle deliveries."
      buttonLabel="Verify"
      trailingIcon="chevron-right"
      isLoading={isLoading}
      error={error}
      phone={phone}
      onChangePhone={setPhone}
      onSubmit={() => {
        void handleContinue();
      }}
      footerText="Already have an account?"
      footerAction="Sign In"
      onFooterPress={() => navigation.navigate('SignIn')}
    />
  );
}
