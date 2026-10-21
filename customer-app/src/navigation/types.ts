import type { NavigatorScreenParams } from '@react-navigation/native';

import type { CustomerAccount } from '../features/account/domain/customerAccount';
import type { AuthFlow, ExistingAccountDetails } from '../features/auth/domain/auth.types';

export type RootStackParamList = {
  Welcome: undefined;
  SignIn: { notice?: string } | undefined;
  SignUp: undefined;
  OtpVerification: {
    phone: string;
    flow: AuthFlow;
  };
  RegistrationForm: {
    registrationToken: string;
    phone: string;
    existing?: ExistingAccountDetails;
  };
  CustomerHome: NavigatorScreenParams<CustomerTabParamList>;
  ParcelRequest: undefined;
  DeliveryTracking: {
    deliveryId: string;
  };
  EditProfile: {
    account: CustomerAccount;
  };
  Unlock: undefined;
};

export type CustomerTabParamList = {
  Dashboard: { nearbyRefreshAt?: number };
  Requests: undefined;
  Profile: undefined;
};
