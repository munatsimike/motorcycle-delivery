const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const { androidFirebaseReadiness, androidPackagesInGoogleServices } = require('./androidFirebaseReadiness');

function appVariant() {
  const value = process.env.APP_VARIANT ?? process.env.EAS_BUILD_PROFILE ?? 'development';
  if (value === 'preview' || value === 'production') {
    return value;
  }
  return 'development';
}

const servicesPath = path.join(__dirname, 'google-services.json');
const googleServicesPresent = existsSync(servicesPath);
const firebase = androidFirebaseReadiness({
  variant: appVariant(),
  googleServicesPresent,
  registeredPackages: googleServicesPresent
    ? androidPackagesInGoogleServices(readFileSync(servicesPath, 'utf8'))
    : [],
});

const disabled = { platforms: { android: null, ios: null } };

module.exports = {
  dependencies: firebase.packageRegistered
    ? {}
    : {
        '@react-native-firebase/app': disabled,
        '@react-native-firebase/crashlytics': disabled,
      },
};
