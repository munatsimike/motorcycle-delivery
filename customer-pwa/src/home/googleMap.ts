import {
  HARARE,
  INITIAL_SPAN,
  MAP_SIDE_PADDING,
  MAP_TOP_PADDING,
  NEIGHBORHOOD_SPAN,
  cameraFor,
  shouldAutoFrame,
  type MapPoint,
} from './camera';
import { customerLocationIcon } from './customerLocation';
import { motorcycleMarkerIcon } from './motorcycleMarker';
import nearby0 from '../assets/rider-motorcycle-nearby-0.png';
import nearby1 from '../assets/rider-motorcycle-nearby-1.png';
import nearby2 from '../assets/rider-motorcycle-nearby-2.png';
import nearby3 from '../assets/rider-motorcycle-nearby-3.png';
import nearby4 from '../assets/rider-motorcycle-nearby-4.png';
import type { NearbyMarker } from './nearby';
import { bindMapTheme } from '../theme/mapStyle';

type MapListener = { remove: () => void };

type GoogleMarker = {
  setMap: (map: GoogleMap | null) => void;
  setPosition: (position: { lat: number; lng: number }) => void;
  setIcon: (icon: unknown) => void;
};

type GoogleMap = {
  setCenter: (position: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  setOptions: (options: Record<string, unknown>) => void;
};

type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => GoogleMarker;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  SymbolPath?: { CIRCLE: number };
  event: {
    addListener: (instance: object, name: string, handler: () => void) => MapListener;
    clearInstanceListeners: (instance: object) => void;
  };
};

type GoogleWindow = Window & {
  google?: { maps?: GoogleMaps };
  gm_authFailure?: () => void;
};

export type HomeMap = {
  showMarkers: (points: readonly NearbyMarker[]) => void;
  tryInitialFrame: (customer: MapPoint | null, cardHeight: number) => void;
  recenter: (customer: MapPoint, cardHeight: number) => void;
  destroy: () => void;
};

let loader: Promise<void> | null = null;

export function loadGoogleMaps(key: string): Promise<void> {
  const googleWindow = window as GoogleWindow;
  if (googleWindow.google?.maps) {
    return Promise.resolve();
  }
  if (!key) {
    return Promise.reject(new Error('Map is unavailable'));
  }
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
      script.onload = () => {
        if (googleWindow.google?.maps) {
          resolve();
          return;
        }
        loader = null;
        reject(new Error('Map is unavailable'));
      };
      script.onerror = () => {
        loader = null;
        reject(new Error('Map is unavailable'));
      };
      document.head.appendChild(script);
    });
  }
  return loader;
}

const NEARBY_MOTORCYCLE_ANGLES = [nearby0, nearby1, nearby2, nearby3, nearby4];

/** Stable visual variety per rider. Nearby API does not provide a travel bearing. */
export function nearbyMotorcycleVariant(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  }
  return (hash >>> 0) % NEARBY_MOTORCYCLE_ANGLES.length;
}

export function createHomeMap(element: HTMLElement, _iconUrl: string, onAuthFailure: () => void): HomeMap {
  const maps = (window as GoogleWindow).google?.maps;
  if (!maps) {
    throw new Error('Map is unavailable');
  }
  const googleWindow = window as GoogleWindow;
  const previousAuthFailure = googleWindow.gm_authFailure;
  googleWindow.gm_authFailure = () => {
    previousAuthFailure?.();
    onAuthFailure();
  };

  let programmatic = false;
  let gestured = false;
  let locked = false;
  let framedCustomer: MapPoint | null = null;
  let framedCard = 0;
  let framedSpan = NEIGHBORHOOD_SPAN;
  let shownPoints: readonly NearbyMarker[] = [];
  let customerMarker: GoogleMarker | null = null;
  const map = createMap(maps, element);
  const releaseTheme = bindMapTheme(map);
  const markers = new Map<string, GoogleMarker>();
  const listeners: MapListener[] = [
    maps.event.addListener(map, 'dragstart', () => {
      gestured = true;
    }),
    maps.event.addListener(map, 'zoom_changed', () => {
      if (!programmatic) gestured = true;
    }),
    maps.event.addListener(map, 'heading_changed', () => {
      if (!programmatic) gestured = true;
    }),
    maps.event.addListener(map, 'tilt_changed', () => {
      if (!programmatic) gestured = true;
    }),
  ];
  const markGesture = () => {
    gestured = true;
  };
  const onTouch = (event: TouchEvent) => {
    if (event.touches.length >= 2) markGesture();
  };
  element.addEventListener('wheel', markGesture, { passive: true });
  element.addEventListener('touchstart', onTouch, { passive: true });
  const resize = new ResizeObserver(() => {
    if (locked || gestured) return;
    show(HARARE, 0, INITIAL_SPAN, null);
  });
  resize.observe(element);

  const frame = (customer: MapPoint, cardHeight: number) => {
    framedCustomer = customer;
    framedCard = cardHeight;
    framedSpan = NEIGHBORHOOD_SPAN;
    show(customer, cardHeight, framedSpan, customer);
    locked = true;
    gestured = false;
    revealMarkers(shownPoints);
  };

  const showCustomer = (customer: MapPoint | null) => {
    const valid = customer !== null
      && Number.isFinite(customer.latitude)
      && Number.isFinite(customer.longitude)
      && customer.latitude >= -90
      && customer.latitude <= 90
      && customer.longitude >= -180
      && customer.longitude <= 180;
    if (!valid || !customer) {
      customerMarker?.setMap(null);
      customerMarker = null;
      return;
    }
    const position = { lat: customer.latitude, lng: customer.longitude };
    const icon = customerLocationIcon(maps.SymbolPath?.CIRCLE ?? 0);
    if (customerMarker) {
      customerMarker.setPosition(position);
      customerMarker.setIcon(icon);
      return;
    }
    customerMarker = new maps.Marker({
      map,
      position,
      title: 'Your location',
      clickable: false,
      optimized: false,
      zIndex: 1,
      icon,
    });
  };

  return {
    showMarkers(points) {
      shownPoints = points;
      const seen = new Set<string>();
      for (const point of points) {
        seen.add(point.id);
        const position = { lat: point.latitude, lng: point.longitude };
        const existing = markers.get(point.id);
        if (existing) {
          existing.setPosition(position);
          continue;
        }
        markers.set(point.id, new maps.Marker({
          map,
          position,
          title: 'Available rider',
          clickable: false,
          optimized: false,
          zIndex: 3,
          icon: motorcycleMarkerIcon(maps, NEARBY_MOTORCYCLE_ANGLES[nearbyMotorcycleVariant(point.id)], 1, 90),
        }));
      }
      for (const [id, marker] of markers) {
        if (seen.has(id)) continue;
        marker.setMap(null);
        markers.delete(id);
      }
      revealMarkers(points);
    },
    tryInitialFrame(customer, cardHeight) {
      showCustomer(customer);
      if (!customer || !shouldAutoFrame({ gestured, locked, customer, cardHeight })) return;
      frame(customer, cardHeight);
    },
    recenter(customer, cardHeight) {
      showCustomer(customer);
      if (cardHeight <= 0) return;
      frame(customer, cardHeight);
    },
    destroy() {
      customerMarker?.setMap(null);
      customerMarker = null;
      releaseTheme();
      resize.disconnect();
      element.removeEventListener('wheel', markGesture);
      element.removeEventListener('touchstart', onTouch);
      for (const listener of listeners) listener.remove();
      for (const marker of markers.values()) marker.setMap(null);
      markers.clear();
      maps.event.clearInstanceListeners(map);
      if (googleWindow.gm_authFailure === previousAuthFailure) {
        return;
      }
      googleWindow.gm_authFailure = previousAuthFailure;
    },
  };

  function revealMarkers(points: readonly NearbyMarker[]) {
    if (!framedCustomer || framedCard <= 0 || points.length === 0 || gestured) return;
    let span = NEIGHBORHOOD_SPAN;
    for (const point of points) {
      span = Math.max(
        span,
        Math.abs(point.latitude - framedCustomer.latitude) * 2.6,
        Math.abs(point.longitude - framedCustomer.longitude) * 2.6,
      );
    }
    if (span <= framedSpan + 0.00001) return;
    framedSpan = span;
    show(framedCustomer, framedCard, framedSpan, framedCustomer);
  }

  function show(center: MapPoint, cardHeight: number, span: number, pin: MapPoint | null) {
    const rect = element.getBoundingClientRect();
    const camera = cameraFor({
      center,
      size: { width: rect.width, height: rect.height },
      span,
      padding: {
        top: pin ? MAP_TOP_PADDING : 0,
        right: pin ? MAP_SIDE_PADDING : 0,
        bottom: pin ? cardHeight : 0,
        left: pin ? MAP_SIDE_PADDING : 0,
      },
      pin,
    });
    programmatic = true;
    map.setCenter({ lat: camera.center.latitude, lng: camera.center.longitude });
    map.setZoom(camera.zoom);
    programmatic = false;
  }
}

function createMap(maps: GoogleMaps, element: HTMLElement): GoogleMap {
  const rect = element.getBoundingClientRect();
  const camera = cameraFor({
    center: HARARE,
    size: { width: rect.width, height: rect.height },
    span: INITIAL_SPAN,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    pin: null,
  });
  const base = {
    center: { lat: HARARE.latitude, lng: HARARE.longitude },
    zoom: camera.zoom,
    disableDefaultUI: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
    keyboardShortcuts: true,
    backgroundColor: '#e7eeea',
  };
  try {
    return new maps.Map(element, {
      ...base,
      tiltInteractionEnabled: true,
      headingInteractionEnabled: true,
    });
  } catch {
    return new maps.Map(element, base);
  }
}
