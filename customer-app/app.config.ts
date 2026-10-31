import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { androidFirebaseReadiness, androidPackagesInGoogleServices } from './androidFirebaseReadiness.js';

type AppVariant = 'development' | 'preview' | 'production';

function appVariant(): AppVariant {
  const value = process.env.APP_VARIANT ?? process.env.EAS_BUILD_PROFILE ?? 'development';
  if (value === 'preview' || value === 'production') {
    return value;
  }
  return 'development';
}

function assertReleaseApiUrl(variant: 'preview' | 'production'): void {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!configured) {
    throw new Error(`The ${variant} build is missing EXPO_PUBLIC_API_BASE_URL.`);
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`The ${variant} build has an invalid EXPO_PUBLIC_API_BASE_URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error(`The ${variant} build requires an https EXPO_PUBLIC_API_BASE_URL.`);
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = appVariant();
  if (variant !== 'development') {
    assertReleaseApiUrl(variant);
  }
  const servicesPath = path.join(__dirname, 'google-services.json');
  const googleServicesPresent = existsSync(servicesPath);
  const firebase = androidFirebaseReadiness({
    variant,
    googleServicesPresent,
    registeredPackages: googleServicesPresent
      ? androidPackagesInGoogleServices(readFileSync(servicesPath, 'utf8'))
      : [],
  });
  const applicationId = firebase.packageName;
  const name = variant === 'preview'
    ? 'Riders Staging'
    : variant === 'production'
      ? 'Riders'
      : config.name ?? 'customer-app';
  return {
    ...config,
    name,
    slug: config.slug ?? 'customer-app',
    scheme: 'riders',
    owner: config.owner ?? 'munatsimike',
    extra: {
      ...config.extra,
      eas: {
        projectId: '910fc8c7-5ba9-43bd-bcb9-7e1f92912405',
      },
      androidFirebase: firebase,
    },
    ios: {
      ...config.ios,
      bundleIdentifier: applicationId,
      supportsTablet: false,
      ...optionalFile('googleServicesFile', 'GoogleService-Info.plist'),
    },
    android: {
      ...config.android,
      package: applicationId,
      ...(firebase.packageRegistered ? optionalFile('googleServicesFile', 'google-services.json') : {}),
      config: {
        ...config.android?.config,
        ...(googleMapsAndroidKey()
          ? { googleMaps: { apiKey: googleMapsAndroidKey() } }
          : {}),
      },
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        'react-native-maps',
        googleMapsAndroidKey() ? { androidGoogleMapsApiKey: googleMapsAndroidKey() } : {},
      ],
    ],
  };
};

function googleMapsAndroidKey(): string {
  return process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY?.trim() ?? '';
}

function optionalFile(key: 'googleServicesFile', filename: string): { googleServicesFile?: string } {
  return existsSync(path.join(__dirname, filename)) ? { [key]: `./${filename}` } : {};
}
