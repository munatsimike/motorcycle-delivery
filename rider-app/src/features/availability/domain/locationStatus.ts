export type LocationAccess =
  | 'granted'
  | 'services-off'
  | 'permission-needed'
  | 'permission-blocked'
  | 'position-unavailable';

export type LocationStatusCopy = {
  title: string;
  detail: string;
};

const COPY: Record<LocationAccess, LocationStatusCopy> = {
  granted: {
    title: 'Location is ready',
    detail: 'Going online shares your location, including while this app is in the background, until you go offline.',
  },
  'services-off': {
    title: 'Location is turned off',
    detail: 'Turn on your device location before you go online.',
  },
  'permission-needed': {
    title: 'Location access needed',
    detail: 'Allow Riders to use your location while you are online so customers nearby can find you.',
  },
  'permission-blocked': {
    title: 'Location access needed',
    detail: 'Allow Riders to use your location while you are online so customers nearby can find you.',
  },
  'position-unavailable': {
    title: 'GPS is unavailable',
    detail: 'Riders could not read a location from this phone. Try again when GPS is available.',
  },
};

export function locationStatusCopy(access: LocationAccess, sharing: boolean): LocationStatusCopy {
  if (access === 'granted' && sharing) {
    return {
      title: 'Sharing your location',
      detail: 'Customers nearby can find you while you stay online. Go offline to stop sharing.',
    };
  }
  return COPY[access];
}
