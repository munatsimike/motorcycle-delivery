import {
  removePushRegistration,
  type PushRegistrationStore,
  type PushRemoval,
} from '../../../notifications/domain/customerPushRegistration';

export const WELCOME_LOGOUT_NOTICE = null;

export type SignOutCustomerResult = {
  signedOut: true;
  welcomeNotice: null;
  push: PushRemoval;
};

export async function signOutCustomer(input: {
  accessToken: string | null;
  pushStore: PushRegistrationStore;
  removePush(accessToken: string, token: string): Promise<void>;
  currentAccessToken(): string | null;
  clearLiveSession(): void | Promise<void>;
  logout(accessToken: string | null): Promise<void>;
}): Promise<SignOutCustomerResult> {
  let push: PushRemoval = 'skipped';
  try {
    push = await removePushRegistration({
      accessToken: input.accessToken,
      store: input.pushStore,
      remove: input.removePush,
    });
  } catch {
    push = 'failed';
  }
  const logoutToken = input.currentAccessToken() ?? input.accessToken;
  try {
    await input.clearLiveSession();
  } catch {
    // Local sign-out still continues.
  }
  try {
    await input.logout(logoutToken);
  } catch {
    // The live session is already cleared when the server cannot be reached.
  }
  return { signedOut: true, welcomeNotice: WELCOME_LOGOUT_NOTICE, push };
}
