import type { NavigatorScreenParams } from '@react-navigation/native';

import type { CustomerAccount } from '../features/account/domain/customerAccount';
import type { AuthFlow } from '../features/auth/domain/auth.types';

export type RootStackParamList = {
  Welcome: undefined;
  SignIn: { notice?: string } | undefined;
  SignUp: undefined;
  OtpVerification: {
    phone: string;
    flow: AuthFlow;
  };
  CustomerHome: NavigatorScreenParams<CustomerTabParamList>;
  ParcelRequest: undefined;
  RequestOpen: {
    id: string;
    status: 'CREATED';
    serviceClass: 'EXPRESS' | 'FLEXIBLE';
    deliverBy: string;
    suggestedPrice: string;
    currency: 'USD';
  };
  DeliveryTracking: {
    deliveryId: string;
  };
  EditProfile: {
    account: CustomerAccount;
  };
};

export type CustomerTabParamList = {
  Dashboard: { nearbyRefreshAt?: number };
  Requests: undefined;
  Profile: undefined;
};
