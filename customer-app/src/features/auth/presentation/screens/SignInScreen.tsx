import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../../../navigation/types';
import PhoneEntryForm from '../components/PhoneEntryForm';
import { useSignIn } from '../viewmodels/useSignIn';

const MISSING_ACCOUNT = 'You don\'t have a customer account for this phone number. If you already have a Riders rider account, you can use the same number to register as a customer.';

type SignInProps = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation, route }: SignInProps) {
  const [phone, setPhone] = useState('');
  const [accountMissing, setAccountMissing] = useState(false);
  const { isLoading, error, requestCode } = useSignIn();

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
      footerText="New to Riders?"
      footerAction="Create account"
      onFooterPress={() => navigation.navigate('SignUp')}
    />
  );
}
