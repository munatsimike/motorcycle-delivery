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

export type LogoutScope = 'current' | 'all';
