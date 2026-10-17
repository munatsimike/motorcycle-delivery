export type RootStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  OtpVerification: {
    phone: string;
    flow: 'registration' | 'login';
    fullName?: string;
  };
  Home: undefined;
};
