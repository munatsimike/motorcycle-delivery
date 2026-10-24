const CUSTOMER_ANDROID_PACKAGE = 'com.riders.customer';
const CUSTOMER_STAGING_ANDROID_PACKAGE = 'com.riders.customer.staging';

function customerAndroidPackage(variant) {
  return variant === 'preview' ? CUSTOMER_STAGING_ANDROID_PACKAGE : CUSTOMER_ANDROID_PACKAGE;
}

function androidFirebaseReadiness(input) {
  const packageName = customerAndroidPackage(input.variant);
  if (!input.googleServicesPresent) {
    return {
      packageName,
      googleServicesFile: false,
      packageRegistered: false,
      diagnostic: `Android FCM is not configured for ${packageName}. Place google-services.json next to app.config.ts and rebuild the development client. Expo Go cannot register an FCM token.`,
    };
  }
  const registered = Array.isArray(input.registeredPackages) ? input.registeredPackages : [];
  if (!registered.includes(packageName)) {
    return {
      packageName,
      googleServicesFile: true,
      packageRegistered: false,
      diagnostic: `google-services.json does not register ${packageName}. Download that Android app from the same Firebase project as the rider app and rebuild the development client.`,
    };
  }
  return { packageName, googleServicesFile: true, packageRegistered: true, diagnostic: null };
}

function androidPackagesInGoogleServices(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.client)) {
      return [];
    }
    return parsed.client
      .map((client) => client?.client_info?.android_client_info?.package_name)
      .filter((name) => typeof name === 'string' && name.length > 0);
  } catch {
    return [];
  }
}

module.exports = {
  CUSTOMER_ANDROID_PACKAGE,
  CUSTOMER_STAGING_ANDROID_PACKAGE,
  customerAndroidPackage,
  androidFirebaseReadiness,
  androidPackagesInGoogleServices,
};
