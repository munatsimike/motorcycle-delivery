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
  CustomerHome: undefined;
  Unlock: undefined;
};

export type CustomerTabParamList = {
  Dashboard: undefined;
  Requests: undefined;
  Profile: undefined;
};
