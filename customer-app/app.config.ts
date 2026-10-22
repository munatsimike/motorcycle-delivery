import type { ConfigContext, ExpoConfig } from 'expo/config';

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
  const applicationId = variant === 'preview' ? 'com.riders.customer.staging' : 'com.riders.customer';
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
    },
    ios: {
      ...config.ios,
      bundleIdentifier: applicationId,
      supportsTablet: false,
    },
    android: {
      ...config.android,
      package: applicationId,
    },
  };
};
