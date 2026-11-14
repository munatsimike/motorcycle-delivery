import { useEffect, useRef } from 'react';
import riderMarker from '../assets/rider-motorcycle-marker.png';
import { mapsBrowserKey } from '../config/env';
import { zoomForSpan } from '../home/camera';
import { loadGoogleMaps } from '../home/googleMap';
import { NEIGHBORHOOD_SPAN } from '../home/camera';
import { showsTrackingRoute, trackingCameraRegion, trackingCameraShouldMove, TRACKING_MAP_HEIGHT, TRACKING_MARKER_CLEARANCE, TRACKING_SHEET_OVERLAP, TRACKING_ZOOM_DELTA, type RoutePoint } from './tracking';
import { bindMapTheme } from '../theme/mapStyle';

type Listener = { remove: () => void };
type Marker = { setMap: (map: object | null) => void; setPosition: (position: { lat: number; lng: number }) => void; setIcon: (icon: unknown) => void };
type Polyline = { setMap: (map: object | null) => void; setPath: (path: { lat: number; lng: number }[]) => void };
type GoogleMap = { setCenter: (position: { lat: number; lng: number }) => void; setZoom: (zoom: number) => void; setOptions: (options: Record<string, unknown>) => void };
type Maps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => Marker;
  Polyline: new (options: Record<string, unknown>) => Polyline;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  event: { addListener: (instance: object, name: string, handler: () => void) => Listener; clearInstanceListeners: (instance: object) => void };
};

export function TrackingMap({
  deliveryId,
  live,
  rider,
  stop,
  headingToDropoff,
  line,
  summary,
  extraMarkers = [],
  pickup = null,
  interactive = true,
  stroke = '#17211D',
  deliveredCallout = null,
  neighborhood = false,
}: {
  deliveryId: string;
  live: boolean;
  rider: RoutePoint | null;
  stop: RoutePoint | null;
  headingToDropoff: boolean;
  line: RoutePoint[];
  summary: string | null;
  extraMarkers?: Array<RoutePoint & { title: string }>;
  pickup?: RoutePoint | null;
  interactive?: boolean;
  stroke?: string;
  deliveredCallout?: DeliveredCallout | null;
  neighborhood?: boolean;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const mapsRef = useRef<Maps | null>(null);
  const riderMarkerRef = useRef<Marker | null>(null);
  const stopMarkerRef = useRef<Marker | null>(null);
  const lineRef = useRef<Polyline | null>(null);
  const gestured = useRef(false);
  const programmatic = useRef(false);
  const extras = useRef<Marker[]>([]);
  const pickupMarker = useRef<Marker | null>(null);
  const labelMarker = useRef<Marker | null>(null);
  const deliveredMarker = useRef<Marker | null>(null);
  const props = useRef({ deliveryId, live, rider, stop, headingToDropoff, line, summary, extraMarkers, pickup, interactive, stroke, deliveredCallout, neighborhood });
  props.current = { deliveryId, live, rider, stop, headingToDropoff, line, summary, extraMarkers, pickup, interactive, stroke, deliveredCallout, neighborhood };
  const markerKey = extraMarkers.map((point) => `${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`).join('|');
  const routeKey = line.length > 1 ? `${line.length}:${line[0].latitude.toFixed(4)}:${line[line.length - 1].latitude.toFixed(4)}` : '';
  const stopKey = stop ? `${stop.latitude.toFixed(5)}:${stop.longitude.toFixed(5)}` : '';
  const stopKeyRef = useRef(stopKey);
  const frameRef = useRef(frame);
  const drawRef = useRef(draw);
  frameRef.current = frame;
  drawRef.current = draw;

  useEffect(() => {
    const element = node.current;
    const key = mapsBrowserKey();
    if (!element || !key) return undefined;
    let cancelled = false;
    const listeners: Listener[] = [];
    loadGoogleMaps(key).then(() => {
      if (cancelled || !node.current) return;
      const maps = (window as Window & { google?: { maps?: Maps } }).google?.maps;
      if (!maps) return;
      mapsRef.current = maps;
      const initial = frameRef.current();
      const map = new maps.Map(node.current, {
        center: { lat: initial.latitude, lng: initial.longitude },
        zoom: zoomForFrame(initial),
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: props.current.interactive ? 'greedy' : 'none',
        backgroundColor: '#e7eeea',
      });
      mapRef.current = map;
      const releaseTheme = bindMapTheme(map);
      listeners.push({ remove: releaseTheme });
      listeners.push(
        maps.event.addListener(map, 'dragstart', () => { gestured.current = true; }),
        maps.event.addListener(map, 'zoom_changed', () => { if (!programmatic.current) gestured.current = true; }),
      );
      drawRef.current();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      for (const listener of listeners) listener.remove();
      riderMarkerRef.current?.setMap(null);
      labelMarker.current?.setMap(null);
      deliveredMarker.current?.setMap(null);
      stopMarkerRef.current?.setMap(null);
      lineRef.current?.setMap(null);
      const maps = mapsRef.current;
      if (maps && mapRef.current) maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const destinationChanged = stopKeyRef.current !== stopKey;
    const decision = trackingCameraShouldMove(destinationChanged, gestured.current);
    stopKeyRef.current = stopKey;
    gestured.current = decision.gestured;
    if (!decision.move) return;
    const map = mapRef.current;
    if (!map) return;
    const next = frameRef.current();
    programmatic.current = true;
    map.setCenter({ lat: next.latitude, lng: next.longitude });
    map.setZoom(zoomForFrame(next));
    programmatic.current = false;
    drawRef.current();
  }, [deliveryId, live, stopKey, markerKey, neighborhood, routeKey]);

  useEffect(() => {
    drawRef.current();
  }, [rider?.latitude, rider?.longitude, headingToDropoff, summary, line.length, extraMarkers.length, pickup?.latitude, pickup?.longitude, deliveredCallout?.name, deliveredCallout?.address, deliveredCallout?.when]);

  function zoomForFrame(next: { latitudeDelta: number; longitudeDelta: number }) {
    const height = node.current?.clientHeight || 480;
    const width = node.current?.clientWidth || height;
    const fitRoute = Boolean(props.current.pickup) && !props.current.live;
    if (!props.current.neighborhood && !fitRoute) return zoomForSpan(next.latitudeDelta, height);
    return Math.min(zoomForSpan(next.latitudeDelta, height), zoomForSpan(next.longitudeDelta, width));
  }

  function frame() {
    const current = props.current;
    if (current.neighborhood && current.stop) return neighborhoodCamera(current.stop, current.extraMarkers);
    if (!current.live && current.pickup && current.stop) return routeCamera(current.line.length > 1 ? current.line : [current.pickup, current.stop]);
    if (current.live && current.rider) return trackingCameraRegion(current.rider, current.stop);
    if (current.stop) return trackingCameraRegion(current.stop, null);
    return { latitude: -17.8292, longitude: 31.0522, latitudeDelta: 0.07, longitudeDelta: 0.07 };
  }

  function move(animated: boolean) {
    const map = mapRef.current;
    if (!map || (gestured.current && !animated)) return;
    const next = frame();
    programmatic.current = true;
    map.setCenter({ lat: next.latitude, lng: next.longitude });
    map.setZoom(zoomForFrame(next));
    programmatic.current = false;
    void animated;
  }

  function draw() {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;
    const current = props.current;
    const path = (current.live || current.pickup) && showsTrackingRoute(current.line.length)
      ? current.line.map((point) => ({ lat: point.latitude, lng: point.longitude }))
      : [];
    const strokeColor = current.stroke === '#17211D' && document.documentElement.dataset.theme === 'dark' ? '#F3F7F5' : current.stroke;
    const strokeWeight = current.pickup ? 5 : 4;
    if (!lineRef.current) lineRef.current = new maps.Polyline({ map, path, strokeColor, strokeWeight });
    else lineRef.current.setPath(path);
    drawPin(maps, map, pickupMarker, current.pickup, 'Pickup', '#169B62');
    const callout = current.deliveredCallout;
    if (!current.stop || callout) {
      stopMarkerRef.current?.setMap(null);
      stopMarkerRef.current = null;
    } else if (!stopMarkerRef.current) {
      stopMarkerRef.current = new maps.Marker({
        map,
        position: { lat: current.stop.latitude, lng: current.stop.longitude },
        title: current.headingToDropoff ? 'Drop-off' : 'Pickup',
        icon: pinIcon(current.headingToDropoff ? '#1A73E8' : '#169B62'),
      });
    } else {
      stopMarkerRef.current.setPosition({ lat: current.stop.latitude, lng: current.stop.longitude });
    }
    if (!callout || !current.stop) {
      deliveredMarker.current?.setMap(null);
      deliveredMarker.current = null;
    } else if (!deliveredMarker.current) {
      deliveredMarker.current = new maps.Marker({
        map,
        position: { lat: current.stop.latitude, lng: current.stop.longitude },
        title: 'Delivered',
        clickable: false,
        zIndex: 4,
        icon: deliveredMarkerIcon(maps, callout),
      });
    } else {
      deliveredMarker.current.setPosition({ lat: current.stop.latitude, lng: current.stop.longitude });
      deliveredMarker.current.setIcon(deliveredMarkerIcon(maps, callout));
      deliveredMarker.current.setMap(map);
    }
    const label = current.live && current.rider ? current.summary : null;
    if (!label || !current.rider) {
      labelMarker.current?.setMap(null);
      labelMarker.current = null;
    } else if (!labelMarker.current) {
      labelMarker.current = new maps.Marker({
        map,
        position: { lat: current.rider.latitude, lng: current.rider.longitude },
        clickable: false,
        zIndex: 4,
        icon: summaryIcon(maps, label),
      });
    } else {
      labelMarker.current.setPosition({ lat: current.rider.latitude, lng: current.rider.longitude });
      labelMarker.current.setIcon(summaryIcon(maps, label));
      labelMarker.current.setMap(map);
    }
    if (!current.live || !current.rider) {
      riderMarkerRef.current?.setMap(null);
      riderMarkerRef.current = null;
    } else if (!riderMarkerRef.current) {
      riderMarkerRef.current = new maps.Marker({
        map,
        position: { lat: current.rider.latitude, lng: current.rider.longitude },
        title: current.summary ? `Rider location, ${current.summary}` : 'Rider location',
        zIndex: 3,
        icon: {
          url: riderMarker,
          scaledSize: new maps.Size(AVAILABLE_MARKER_WIDTH, AVAILABLE_MARKER_HEIGHT),
          anchor: new maps.Point(AVAILABLE_MARKER_WIDTH / 2, AVAILABLE_MARKER_HEIGHT / 2),
        },
      });
    } else {
      riderMarkerRef.current.setPosition({ lat: current.rider.latitude, lng: current.rider.longitude });
    }
    extras.current.forEach((marker) => marker.setMap(null));
    extras.current = current.extraMarkers.map((point) => new maps.Marker({
      map,
      position: { lat: point.latitude, lng: point.longitude },
      title: point.title,
      clickable: false,
      zIndex: 3,
      icon: {
        url: riderMarker,
        scaledSize: new maps.Size(AVAILABLE_MARKER_WIDTH, AVAILABLE_MARKER_HEIGHT),
        anchor: new maps.Point(AVAILABLE_MARKER_WIDTH / 2, AVAILABLE_MARKER_HEIGHT / 2),
      },
    }));
  }

  function drawPin(maps: Maps, map: GoogleMap, slot: { current: Marker | null }, point: RoutePoint | null, title: string, color: string) {
    if (!point) {
      slot.current?.setMap(null);
      slot.current = null;
      return;
    }
    if (!slot.current) {
      slot.current = new maps.Marker({ map, position: { lat: point.latitude, lng: point.longitude }, title, icon: pinIcon(color) });
      return;
    }
    slot.current.setPosition({ lat: point.latitude, lng: point.longitude });
  }

  return (
    <div className="track-map">
      <div ref={node} className="track-map-canvas" />
      <button type="button" className="track-recenter" aria-label="Recenter map" onClick={() => { gestured.current = false; move(true); }}>◎</button>
    </div>
  );
}

type DeliveredCallout = { name: string; address: string; when: string };

function deliveredMarkerIcon(maps: Maps, callout: DeliveredCallout) {
  const lines = [callout.name, callout.address].filter((line) => line.length > 0);
  const width = 236;
  const padX = 12;
  const padY = 8;
  const titleH = 18;
  const lineH = 17;
  const cardH = padY * 2 + titleH + (lines.length + (callout.when ? 1 : 0)) * (lineH + 3);
  const pin = 36;
  const height = cardH + 8 + pin;
  const text = [
    `<circle cx="${padX + 8}" cy="${padY + 8}" r="8" fill="#ffffff"/>`,
    `<path d="M${padX + 4.2} ${padY + 8.2}l2.4 2.4 5.2-5.4" fill="none" stroke="#16845B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="${padX + 22}" y="${padY + 13}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">Delivered</text>`,
  ];
  lines.forEach((line, index) => {
    text.push(`<text x="${padX}" y="${padY + titleH + 6 + index * (lineH + 3)}" font-family="Arial, sans-serif" font-size="13" font-weight="${index === 0 && callout.name ? '600' : '400'}" fill="#ffffff">${escapeXml(truncate(line, 28))}</text>`);
  });
  if (callout.when) {
    const y = padY + titleH + 6 + lines.length * (lineH + 3);
    text.push(`<circle cx="${padX + 6}" cy="${y - 4}" r="5.5" fill="none" stroke="#ffffff" stroke-width="1.2"/>`);
    text.push(`<path d="M${padX + 6} ${y - 7}v3.2l2.2 1.3" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>`);
    text.push(`<text x="${padX + 16}" y="${y}" font-family="Arial, sans-serif" font-size="13" font-weight="500" fill="#ffffff">${escapeXml(callout.when)}</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="2" y="3" width="${width - 4}" height="${cardH}" rx="16" fill="rgba(23,33,29,0.2)"/><rect width="${width}" height="${cardH}" rx="16" fill="#16845B"/>${text.join('')}<svg x="${(width - pin) / 2}" y="${cardH + 5}" width="${pin}" height="${pin}" viewBox="0 0 24 24"><path fill="#1A73E8" d="M12 2.2a6.2 6.2 0 0 0-6.2 6.2c0 4.7 6.2 12.2 6.2 12.2s6.2-7.5 6.2-12.2A6.2 6.2 0 0 0 12 2.2z"/></svg></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(width, height),
    anchor: new maps.Point(width / 2, height - 2),
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const AVAILABLE_MARKER_WIDTH = 106;
const AVAILABLE_MARKER_HEIGHT = 115;

function routeCamera(points: RoutePoint[]) {
  let minLatitude = points[0].latitude;
  let maxLatitude = points[0].latitude;
  let minLongitude = points[0].longitude;
  let maxLongitude = points[0].longitude;
  for (const point of points) {
    minLatitude = Math.min(minLatitude, point.latitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
  }
  const latitudeDelta = Math.max(maxLatitude - minLatitude, TRACKING_ZOOM_DELTA);
  const longitudeDelta = Math.max(maxLongitude - minLongitude, TRACKING_ZOOM_DELTA);
  const openHeight = TRACKING_MAP_HEIGHT - TRACKING_SHEET_OVERLAP - TRACKING_MARKER_CLEARANCE;
  const liftedLatitudeDelta = latitudeDelta * (TRACKING_MAP_HEIGHT / openHeight);
  const openCenter = TRACKING_MARKER_CLEARANCE + openHeight / 2;
  const southOfCenter = (TRACKING_MAP_HEIGHT / 2 - openCenter) / TRACKING_MAP_HEIGHT;
  return {
    latitude: (minLatitude + maxLatitude) / 2 - southOfCenter * liftedLatitudeDelta,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: liftedLatitudeDelta,
    longitudeDelta,
  };
}

function neighborhoodCamera(stop: RoutePoint, markers: RoutePoint[]) {
  const points = [stop, ...markers];
  let minLatitude = points[0].latitude;
  let maxLatitude = points[0].latitude;
  let minLongitude = points[0].longitude;
  let maxLongitude = points[0].longitude;
  for (const point of points) {
    minLatitude = Math.min(minLatitude, point.latitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
  }
  const latitudeDelta = Math.max((maxLatitude - minLatitude) * 1.25, NEIGHBORHOOD_SPAN);
  const longitudeDelta = Math.max((maxLongitude - minLongitude) * 1.25, NEIGHBORHOOD_SPAN);
  const openHeight = TRACKING_MAP_HEIGHT - TRACKING_SHEET_OVERLAP - TRACKING_MARKER_CLEARANCE;
  const openCenter = TRACKING_MARKER_CLEARANCE + openHeight / 2;
  const southOfCenter = (TRACKING_MAP_HEIGHT / 2 - openCenter) / TRACKING_MAP_HEIGHT;
  return {
    latitude: (minLatitude + maxLatitude) / 2 - southOfCenter * latitudeDelta,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

function summaryIcon(maps: Maps, text: string) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const width = Math.min(220, Math.max(72, Math.round(text.length * 7.2) + 16));
  const height = 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="12" fill="${dark ? '#101614' : '#ffffff'}"/><text x="${width / 2}" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="${dark ? '#F3F7F5' : '#17211D'}">${escapeXml(text)}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(width, height),
    anchor: new maps.Point(width / 2, height + 70),
  };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

function pinIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><path fill="${color}" d="M12 2.2a6.2 6.2 0 0 0-6.2 6.2c0 4.7 6.2 12.2 6.2 12.2s6.2-7.5 6.2-12.2A6.2 6.2 0 0 0 12 2.2z"/></svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` };
}
