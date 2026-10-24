export const RIDER_MAP_ZOOM = 15;
export const RIDER_TILE_SIZE = 256;
export const MAP_TILE_ATTRIBUTION = '© MapTiler © OpenStreetMap contributors';
export const MAP_TILE_USER_AGENT = 'RidersCustomerMap';

const MAPTILER_TILE_ROOT = 'https://api.maptiler.com/maps/streets-v4/256';
const MAPTILER_HOST = 'api.maptiler.com';
const PUBLIC_OSM_TILE_HOST = 'tile.openstreetmap.org';
const KEY_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;
const MAX_LATITUDE = 85.05112878;

export type RiderMapPoint = {
  deliveryId: string;
  latitude: number;
  longitude: number;
};

export type RiderMapFrame = {
  deliveryId: string;
  url: string | null;
  attribution: string | null;
  markerX: number;
  markerY: number;
};

export type MapTileImageSource = {
  uri: string;
  headers: { 'User-Agent': string };
};

export type MapTileProvider = {
  kind: 'unconfigured' | 'maptiler';
  attribution: string | null;
  tileUrl(x: number, y: number, zoom: number): string | null;
};

const unconfiguredProvider: MapTileProvider = {
  kind: 'unconfigured',
  attribution: null,
  tileUrl() {
    return null;
  },
};

export function readMapTileProvider(env: Record<string, string | undefined> = process.env): MapTileProvider {
  const key = normalizeMapTileKey(env.EXPO_PUBLIC_MAP_TILE_KEY);
  if (!key) {
    return unconfiguredProvider;
  }
  return {
    kind: 'maptiler',
    attribution: MAP_TILE_ATTRIBUTION,
    tileUrl(x, y, zoom) {
      return mapTilerTileUrl(key, x, y, zoom);
    },
  };
}

export function riderMapFrame(
  active: boolean,
  point: RiderMapPoint | null,
  provider: MapTileProvider = readMapTileProvider(),
): RiderMapFrame | null {
  if (!active || !point) {
    return null;
  }
  const tile = slippyTile(point.latitude, point.longitude, RIDER_MAP_ZOOM);
  if (!tile) {
    return null;
  }
  const url = provider.tileUrl(tile.x, tile.y, RIDER_MAP_ZOOM);
  return {
    deliveryId: point.deliveryId,
    url,
    attribution: url ? provider.attribution : null,
    markerX: tile.markerX,
    markerY: tile.markerY,
  };
}

export function sameRiderTile(previous: RiderMapFrame | null, next: RiderMapFrame | null): boolean {
  return previous?.deliveryId === next?.deliveryId && previous?.url === next?.url;
}

export function mapTileImageSource(url: string | null): MapTileImageSource | null {
  if (!url || url.includes(PUBLIC_OSM_TILE_HOST)) {
    return null;
  }
  return {
    uri: url,
    headers: { 'User-Agent': MAP_TILE_USER_AGENT },
  };
}

export function normalizeMapTileKey(value: string | undefined): string | null {
  const key = value?.trim() ?? '';
  if (!KEY_PATTERN.test(key) || /openstreetmap|maptiler\.com|https?:/i.test(key)) {
    return null;
  }
  return key;
}

function mapTilerTileUrl(key: string, x: number, y: number, zoom: number): string | null {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 20) {
    return null;
  }
  const size = 2 ** zoom;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) {
    return null;
  }
  const url = `${MAPTILER_TILE_ROOT}/${zoom}/${x}/${y}.png?key=${encodeURIComponent(key)}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== MAPTILER_HOST || parsed.hostname.endsWith(PUBLIC_OSM_TILE_HOST)) {
      return null;
    }
  } catch {
    return null;
  }
  return url;
}

function slippyTile(
  latitude: number,
  longitude: number,
  zoom: number,
): { x: number; y: number; markerX: number; markerY: number } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  const size = 2 ** zoom;
  const wrapped = ((longitude + 180) / 360) * size;
  const xFloat = ((wrapped % size) + size) % size;
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  const latitudeRad = (clamped * Math.PI) / 180;
  const yFloat = (1 - Math.log(Math.tan(latitudeRad) + 1 / Math.cos(latitudeRad)) / Math.PI) / 2 * size;
  if (!Number.isFinite(xFloat) || !Number.isFinite(yFloat) || yFloat < 0 || yFloat >= size) {
    return null;
  }
  return {
    x: Math.floor(xFloat),
    y: Math.floor(yFloat),
    markerX: xFloat - Math.floor(xFloat),
    markerY: yFloat - Math.floor(yFloat),
  };
}
