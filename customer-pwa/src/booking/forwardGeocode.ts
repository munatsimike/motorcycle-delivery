import { mapsBrowserKey } from '../config/env';
import { loadGoogleMaps } from '../home/googleMap';
import { manualGeocodeAccepts } from './places';

type ForwardResult = {
  formatted_address?: string;
  geometry?: { location?: { lat: () => number; lng: () => number } };
};

type ForwardGeocoder = {
  geocode: (
    request: { address: string },
    callback: (results: ForwardResult[] | null, status: string) => void,
  ) => void;
};

export async function geocodeManualAddress(address: string): Promise<{ latitude: string; longitude: string } | null> {
  const text = address.trim();
  if (text.length < 3) return null;
  let found: ForwardResult | null = null;
  try {
    await loadGoogleMaps(mapsBrowserKey());
    const Geocoder = (window as Window & { google?: { maps?: { Geocoder?: new () => ForwardGeocoder } } }).google?.maps?.Geocoder;
    if (!Geocoder) return null;
    found = await new Promise<ForwardResult | null>((resolve) => {
      new Geocoder().geocode({ address: text }, (results, status) => {
        resolve(status === 'OK' ? results?.[0] ?? null : null);
      });
    });
  } catch {
    return null;
  }
  const formatted = found?.formatted_address?.trim() ?? '';
  const latitude = found?.geometry?.location?.lat();
  const longitude = found?.geometry?.location?.lng();
  if (!formatted || !manualGeocodeAccepts(text, formatted)) return null;
  if (latitude === undefined || longitude === undefined || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude: latitude.toFixed(7), longitude: longitude.toFixed(7) };
}
