import { describe, expect, it } from 'vitest';

import {
  androidFirebaseReadiness,
  CUSTOMER_ANDROID_PACKAGE,
  CUSTOMER_STAGING_ANDROID_PACKAGE,
} from '../../../../androidFirebaseReadiness.js';

describe('Android Firebase readiness', () => {
  it('names the development and staging packages and explains a missing google-services file', () => {
    expect(androidFirebaseReadiness({ variant: 'development', googleServicesPresent: false })).toEqual({
      packageName: CUSTOMER_ANDROID_PACKAGE,
      googleServicesFile: false,
      packageRegistered: false,
      diagnostic: `Android FCM is not configured for ${CUSTOMER_ANDROID_PACKAGE}. Place google-services.json next to app.config.ts and rebuild the development client. Expo Go cannot register an FCM token.`,
    });
    expect(androidFirebaseReadiness({ variant: 'production', googleServicesPresent: false }).packageName)
      .toBe(CUSTOMER_ANDROID_PACKAGE);
    expect(androidFirebaseReadiness({ variant: 'preview', googleServicesPresent: false }).packageName)
      .toBe(CUSTOMER_STAGING_ANDROID_PACKAGE);
  });

  it('stays quiet when the services file is present and does not include a credential', () => {
    const ready = androidFirebaseReadiness({
      variant: 'development',
      googleServicesPresent: true,
      registeredPackages: [CUSTOMER_ANDROID_PACKAGE],
    });
    expect(ready).toEqual({
      packageName: CUSTOMER_ANDROID_PACKAGE,
      googleServicesFile: true,
      packageRegistered: true,
      diagnostic: null,
    });
    expect(JSON.stringify(ready)).not.toMatch(/private_key|api_key|AIza/i);
    const staging = androidFirebaseReadiness({
      variant: 'preview',
      googleServicesPresent: true,
      registeredPackages: [CUSTOMER_ANDROID_PACKAGE],
    });
    expect(staging.packageRegistered).toBe(false);
    expect(staging.diagnostic).toContain(CUSTOMER_STAGING_ANDROID_PACKAGE);
  });
});
