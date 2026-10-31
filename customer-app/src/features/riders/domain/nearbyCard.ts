import type { NearbyAvailability } from './nearbyAvailability';

export type RiderAlertPhase = 'checking' | 'off' | 'active' | 'denied';

export type NearbyCardContent = {
  title: string;
  message: string;
  action: 'turn-on-location' | 'allow-location' | 'try-again' | 'notify' | 'cancel-alert' | 'open-notification-settings' | null;
  tone: 'amber' | 'neutral' | 'green' | 'danger';
  icon: 'map-marker-off-outline' | 'map-marker-alert-outline' | 'crosshairs-gps' | 'bike' | 'cloud-off-outline' | 'bell-outline';
};

export function nearbyCardContent(state: NearbyAvailability): NearbyCardContent | null {
  if (state.status === 'loading') {
    return null;
  }
  if (state.status === 'services-off') {
    return {
      title: 'Location is turned off',
      message: 'Turn on your device location to see available riders near you.',
      action: 'turn-on-location',
      tone: 'amber',
      icon: 'map-marker-off-outline',
    };
  }
  if (state.status === 'permission-denied') {
    return {
      title: 'Location access needed',
      message: 'Allow Riders to access your location to find available riders nearby.',
      action: 'allow-location',
      tone: 'neutral',
      icon: 'map-marker-alert-outline',
    };
  }
  if (state.status === 'position-unavailable') {
    return {
      title: 'Unable to find your location',
      message: "We couldn't determine your current location. Please try again.",
      action: 'try-again',
      tone: 'amber',
      icon: 'crosshairs-gps',
    };
  }
  if (state.status === 'check-failed') {
    return {
      title: 'Unable to check rider availability',
      message: state.message,
      action: 'try-again',
      tone: 'danger',
      icon: 'cloud-off-outline',
    };
  }
  if (state.count === 0) {
    return {
      title: 'Nearby riders',
      message: '0 riders are available near you.',
      action: null,
      tone: 'neutral',
      icon: 'bike',
    };
  }
  const riders = state.count === 1 ? '1 rider is' : `${state.count} riders are`;
  return {
    title: 'Nearby riders',
    message: `${riders} available near you.`,
    action: null,
    tone: 'green',
    icon: 'bike',
  };
}

export function nearbyHomeCountLabel(state: NearbyAvailability): string {
  if (state.status === 'loading') {
    return 'Checking';
  }
  if (state.status === 'services-off') {
    return 'Location is off';
  }
  if (state.status === 'permission-denied') {
    return 'Location needed';
  }
  if (state.status === 'position-unavailable') {
    return 'Location unavailable';
  }
  if (state.status === 'check-failed') {
    return 'Unable to check';
  }
  if (state.count === 0) {
    return '0 riders nearby';
  }
  return String(state.count);
}

export function nearbyActionLabel(action: NearbyCardContent['action']): string | null {
  if (action === 'turn-on-location') {
    return 'Turn On Location';
  }
  if (action === 'allow-location') {
    return 'Allow Location';
  }
  if (action === 'try-again') {
    return 'Try Again';
  }
  if (action === 'notify') {
    return 'Notify me when available';
  }
  if (action === 'cancel-alert') {
    return 'Cancel alert';
  }
  if (action === 'open-notification-settings') {
    return 'Open settings';
  }
  return null;
}
