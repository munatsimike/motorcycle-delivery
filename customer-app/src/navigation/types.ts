import type { NavigatorScreenParams } from '@react-navigation/native';

import type { CustomerAccount } from '../features/account/domain/customerAccount';
import type { AuthFlow } from '../features/auth/domain/auth.types';

export type RootStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  OtpVerification: {
    phone: string;
    flow: AuthFlow;
  };
  RegistrationForm: {
    registrationToken: string;
    phone: string;
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
