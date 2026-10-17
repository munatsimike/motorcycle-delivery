import type { NavigatorScreenParams } from '@react-navigation/native';

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
  Unlock: undefined;
};

export type CustomerTabParamList = {
  Dashboard: { nearbyRefreshAt?: number };
  Requests: undefined;
  Profile: undefined;
};
