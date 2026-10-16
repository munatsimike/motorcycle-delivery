import type { NearbyAvailability } from './nearbyAvailability';

export type NearbyCardContent = {
  title: string;
  message: string;
  action: 'turn-on-location' | 'allow-location' | 'try-again' | null;
  tone: 'amber' | 'neutral' | 'green' | 'danger';
  icon: 'map-marker-off' | 'map-marker-alert-outline' | 'crosshairs-gps' | 'motorbike' | 'cloud-off-outline';
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
      icon: 'map-marker-off',
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
      icon: 'motorbike',
    };
  }
  const riders = state.count === 1 ? '1 rider is' : `${state.count} riders are`;
  return {
    title: 'Nearby riders',
    message: `${riders} available near you.`,
    action: null,
    tone: 'green',
    icon: 'motorbike',
  };
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
  return null;
}
