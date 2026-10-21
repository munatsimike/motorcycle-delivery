export type AccountKind = 'INDIVIDUAL' | 'BUSINESS';

export type AuthFlow = 'registration' | 'login';

export type PendingOtp = {
  status: 'pending';
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export type RegistrationProof = {
  status: 'verified';
  registrationToken: string;
  existing?: ExistingAccountDetails;
};

export type ExistingAccountDetails = {
  fullName: string;
  phone: string;
  address: string | null;
  readOnly: Array<'fullName' | 'phone' | 'address'>;
  missing: Array<'accountKind' | 'address'>;
};

export type SignInRequired = {
  status: 'sign_in';
};

export type RegistrationVerification = RegistrationProof | SignInRequired | AuthSession;

export type IndividualProfile = {
  accountKind: 'INDIVIDUAL';
  fullName: string;
  address: string;
};

export type BusinessProfile = {
  accountKind: 'BUSINESS';
  businessName: string;
  contactName: string;
  address: string;
};

export type CustomerProfile = IndividualProfile | BusinessProfile;

export type CompleteRegistrationRequest = CustomerProfile & {
  registrationToken: string;
};
