import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../auth/sessionContext';
import { mapsBrowserKey } from '../config/env';
import { readBrowserLocation } from './browserLocation';
import { createHomeMap, loadGoogleMaps, type HomeMap } from './googleMap';
import { fetchNearbyRiders } from './nearbyApi';
import {
  isNearbyRiderPointExpired,
  nextNearbyMarkers,
  type DeviceLocation,
  type NearbyAvailability,
  type NearbyMarker,
} from './nearby';
import type { MapPoint } from './camera';

const REFRESH_MS = 20_000;
const PRUNE_MS = 5_000;
const POLL_MAX_AGE_MS = 15_000;

export function useCustomerHome(mapElement: HTMLDivElement | null, cardHeight: number, iconUrl: string) {
  const { accessToken } = useSession();
  const [availability, setAvailability] = useState<NearbyAvailability>({ status: 'loading' });
  const [customer, setCustomer] = useState<MapPoint | null>(null);
  const [points, setPoints] = useState<readonly NearbyMarker[]>([]);
  const [mapProblem, setMapProblem] = useState<string | null>(null);
  const mapRef = useRef<HomeMap | null>(null);
  const pointsRef = useRef<readonly NearbyMarker[]>([]);
  const customerRef = useRef<MapPoint | null>(null);
  const cardRef = useRef(cardHeight);
  const blockLocation = useRef(false);
  const refreshing = useRef(false);
  const request = useRef(0);
  const markerIds = useRef(0);
  customerRef.current = customer;
  cardRef.current = cardHeight;

  const publish = useCallback((shown: readonly NearbyMarker[], next: NearbyAvailability) => {
    pointsRef.current = shown;
    setPoints(shown);
    setAvailability(next);
  }, []);

  useEffect(() => {
    if (!mapElement) return undefined;
    const key = mapsBrowserKey();
    if (!key) {
      setMapProblem('Map is unavailable');
      return undefined;
    }
    let cancelled = false;
    let created: HomeMap | null = null;
    loadGoogleMaps(key).then((loaded) => {
      if (cancelled) return loaded;
      created = createHomeMap(mapElement, iconUrl, () => {
        if (!cancelled) setMapProblem('Map is unavailable');
      });
      mapRef.current = created;
      created.showMarkers(pointsRef.current);
      created.tryInitialFrame(customerRef.current, cardRef.current);
      return loaded;
    }).catch(() => {
      if (!cancelled) setMapProblem('Map is unavailable');
    });
    return () => {
      cancelled = true;
      created?.destroy();
      if (mapRef.current === created) mapRef.current = null;
    };
  }, [iconUrl, mapElement]);

  useEffect(() => {
    mapRef.current?.showMarkers(points);
  }, [points]);

  useEffect(() => {
    mapRef.current?.tryInitialFrame(customer, cardHeight);
  }, [cardHeight, customer]);

  const refresh = useCallback(async (mode: 'poll' | 'retry') => {
    if (mode === 'poll' && blockLocation.current) return;
    if (refreshing.current) return;
    refreshing.current = true;
    const current = ++request.current;
    const createMarkerId = () => {
      markerIds.current += 1;
      return `nearby-marker-${markerIds.current}`;
    };
    const retainMarkers = () => nextNearbyMarkers(pointsRef.current, { status: 'failed' }, createMarkerId, new Date());
    try {
      const location = await readBrowserLocation(mode === 'retry' ? 0 : POLL_MAX_AGE_MS);
      if (request.current !== current) return;
      if (location.status !== 'ready') {
        blockLocation.current = pausesLocation(location);
        setCustomer(null);
        const shown = nextNearbyMarkers(pointsRef.current, { status: 'failed' }, createMarkerId, new Date());
        publish(shown, location);
        return;
      }
      blockLocation.current = false;
      const point = { latitude: location.latitude, longitude: location.longitude };
      setCustomer(point);
      let token: string | null;
      try {
        token = await accessToken();
      } catch (error) {
        if (request.current !== current) return;
        publish(retainMarkers(), { status: 'check-failed', message: messageFrom(error) });
        return;
      }
      if (request.current !== current) return;
      if (!token) {
        publish(retainMarkers(), { status: 'check-failed', message: 'Rider availability is unavailable.' });
        return;
      }
      try {
        const nearby = await fetchNearbyRiders(token, point.latitude, point.longitude);
        if (request.current !== current) return;
        const shown = nextNearbyMarkers(pointsRef.current, { status: 'ready', points: nearby.points }, createMarkerId, new Date());
        publish(shown, { status: 'ready', count: shown.length });
      } catch (error) {
        if (request.current !== current) return;
        publish(retainMarkers(), { status: 'check-failed', message: messageFrom(error) });
      }
    } finally {
      refreshing.current = false;
    }
  }, [accessToken, publish]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh('poll');
    };
    void refresh('poll');
    const interval = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      request.current += 1;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  useEffect(() => {
    if (points.length === 0) return undefined;
    const timer = window.setInterval(() => {
      const now = new Date();
      const next = pointsRef.current.filter((point) => !isNearbyRiderPointExpired(point, now));
      if (next.length === pointsRef.current.length) return;
      pointsRef.current = next;
      setPoints(next);
      setAvailability((state) => (state.status === 'ready' ? { status: 'ready', count: next.length } : state));
    }, PRUNE_MS);
    return () => window.clearInterval(timer);
  }, [points.length]);

  const retry = useCallback(() => {
    blockLocation.current = false;
    void refresh('retry');
  }, [refresh]);

  const recenter = useCallback(() => {
    if (!customer) return;
    mapRef.current?.recenter(customer, cardHeight);
  }, [cardHeight, customer]);

  return { availability, customer, mapProblem, retry, recenter };
}

function pausesLocation(location: DeviceLocation): boolean {
  return location.status === 'permission-denied' || location.status === 'services-off';
}

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Check your connection and try again.';
}
