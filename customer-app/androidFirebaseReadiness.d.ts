export const CUSTOMER_ANDROID_PACKAGE: string;
export const CUSTOMER_STAGING_ANDROID_PACKAGE: string;

export function customerAndroidPackage(variant: 'development' | 'preview' | 'production'): string;

export function androidPackagesInGoogleServices(raw: string): string[];

export function androidFirebaseReadiness(input: {
  variant: 'development' | 'preview' | 'production';
  googleServicesPresent: boolean;
  registeredPackages?: string[];
}): {
  packageName: string;
  googleServicesFile: boolean;
  packageRegistered: boolean;
  diagnostic: string | null;
};
