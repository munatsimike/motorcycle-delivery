import { useEffect, useRef } from "react";
import { CrosshairIcon } from "../components/CrosshairIcon";
import { mapsBrowserKey } from "../config/env";
import { zoomForSpan } from "../home/camera";
import { DIRECTIONAL_MOTORCYCLE_ICONS, directionalMotorcycleUrl } from "../home/directionalMotorcycles";
import { squareMotorcycleMarkerIcon } from "../home/motorcycleMarker";
import { motorcycleDirection, type MotorcycleDirection } from "./motorcycleDirection";
import { loadGoogleMaps } from "../home/googleMap";
import {
  SEARCH_PULSE_FRAME_MS,
  SEARCH_PULSE_MS,
  searchPulseRings,
} from "./searchPulse";
import {
  advanceMotorcycleHeading,
  offersFrameHolds,
  offersMapCamera,
  showsTrackingRoute,
  trackingCameraRegion,
  trackingCameraShouldMove,
  trackingFrameHolds,
  ARRIVAL_MAX_ZOOM,
  capTrackingCameraZoom,
  keepArrivalCamera,
  trackingRouteCamera,
  PICKUP_ARRIVED_TAG,
  TRACKING_MAP_HEIGHT,
  TRACKING_MARKER_CLEARANCE,
  TRACKING_SHEET_OVERLAP,
  TRACKING_ZOOM_DELTA,
  type MotorcycleHeading,
  type OffersMapFrame,
  type RoutePoint,
} from "./tracking";
import { bindMapTheme } from "../theme/mapStyle";

/** 72% of the previous 90px marker, matching the rider app. Rounded to 65px when drawn. */
const TRACKING_MOTORCYCLE_WIDTH = 64.8;

type Listener = { remove: () => void };
type Marker = {
  setMap: (map: object | null) => void;
  setPosition: (position: { lat: number; lng: number }) => void;
  setIcon: (icon: unknown) => void;
  setOptions: (options: { rotation?: number }) => void;
};
type RiderMarkerPoint = RoutePoint & { bearingDegrees?: number | null };
type Polyline = {
  setMap: (map: object | null) => void;
  setPath: (path: { lat: number; lng: number }[]) => void;
};
type Circle = {
  setMap: (map: object | null) => void;
  setCenter: (position: { lat: number; lng: number }) => void;
  setRadius: (radius: number) => void;
  setOptions: (options: Record<string, unknown>) => void;
};
type GoogleMap = {
  setCenter: (position: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  setOptions: (options: Record<string, unknown>) => void;
};
type Maps = {
  Map: new (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => Marker;
  Polyline: new (options: Record<string, unknown>) => Polyline;
  Circle: new (options: Record<string, unknown>) => Circle;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  event: {
    addListener: (
      instance: object,
      name: string,
      handler: () => void,
    ) => Listener;
    clearInstanceListeners: (instance: object) => void;
  };
};

export function TrackingMap({
  deliveryId,
  live,
  rider,
  stop,
  headingToDropoff,
  line,
  hideRoute = false,
  summary,
  extraMarkers = [],
  pickup = null,
  interactive = true,
  stroke = "#17211D",
  deliveredCallout = null,
  neighborhood = false,
  pickupLabel = null,
}: {
  deliveryId: string;
  live: boolean;
  rider: RiderMarkerPoint | null;
  stop: RoutePoint | null;
  headingToDropoff: boolean;
  line: RoutePoint[];
  hideRoute?: boolean;
  summary: string | null;
  extraMarkers?: Array<RoutePoint & { title: string; id?: string }>;
  pickup?: RoutePoint | null;
  interactive?: boolean;
  stroke?: string;
  deliveredCallout?: DeliveredCallout | null;
  neighborhood?: boolean;
  pickupLabel?: string | null;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const mapsRef = useRef<Maps | null>(null);
  const riderMarkerRef = useRef<Marker | null>(null);
  const stopMarkerRef = useRef<Marker | null>(null);
  const lineRef = useRef<Polyline | null>(null);
  const gestured = useRef(false);
  const programmatic = useRef(false);
  const extras = useRef<Map<string, Marker>>(new Map());
  const pulseCircles = useRef<Circle[]>([]);
  const pulseTimer = useRef<number | null>(null);
  const pulseStarted = useRef(0);
  const pulseElapsed = useRef(0);
  const pausePulseRef = useRef<() => void>(() => undefined);
  const syncPulseRef = useRef<() => void>(() => undefined);
  const pickupMarker = useRef<Marker | null>(null);
  const labelMarker = useRef<Marker | null>(null);
  const deliveredMarker = useRef<Marker | null>(null);
  const headingTrack = useRef<MotorcycleHeading>({
    heading: null,
    anchor: null,
  });
  const directionRef = useRef<MotorcycleDirection | null>(null);
  const motorcycleIconUrl = useRef<string | null>(null);
  const labelText = useRef<string | null>(null);
  const heldOffers = useRef<{
    width: number;
    height: number;
    frame: OffersMapFrame;
  } | null>(null);
  const heldRoute = useRef<{
    width: number;
    height: number;
    bottom: number;
    frame: OffersMapFrame;
  } | null>(null);
  const framedIdentity = useRef("");
  const props = useRef({
    deliveryId,
    live,
    rider,
    stop,
    headingToDropoff,
    line,
    hideRoute,
    summary,
    extraMarkers,
    pickup,
    interactive,
    stroke,
    deliveredCallout,
    neighborhood,
    pickupLabel,
  });
  props.current = {
    deliveryId,
    live,
    rider,
    stop,
    headingToDropoff,
    line,
    hideRoute,
    summary,
    extraMarkers,
    pickup,
    interactive,
    stroke,
    deliveredCallout,
    neighborhood,
    pickupLabel,
  };
  const markerKey = extraMarkers
    .map(
      (point) =>
        `${point.id ?? ""}:${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`,
    )
    .join("|");
  const routeKey =
    line.length > 1
      ? `${line.length}:${line[0].latitude.toFixed(4)}:${line[line.length - 1].latitude.toFixed(4)}`
      : "";
  const stopKey = stop
    ? `${stop.latitude.toFixed(5)}:${stop.longitude.toFixed(5)}`
    : "";
  const riderShown = rider !== null;
  const tagShown = Boolean(live && rider && summary);
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
    loadGoogleMaps(key)
      .then(() => {
        if (cancelled || !node.current) return;
        const maps = (window as Window & { google?: { maps?: Maps } }).google
          ?.maps;
        if (!maps) return;
        mapsRef.current = maps;
        const initial = frameRef.current();
        const map = new maps.Map(node.current, {
          center: { lat: initial.latitude, lng: initial.longitude },
          zoom: zoomForFrame(initial),
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: props.current.interactive ? "greedy" : "none",
          backgroundColor: "#e7eeea",
        });
        mapRef.current = map;
        const releaseTheme = bindMapTheme(map);
        listeners.push({ remove: releaseTheme });
        const themeObserver = new MutationObserver(() => drawRef.current());
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });
        listeners.push({ remove: () => themeObserver.disconnect() });
        listeners.push(
          maps.event.addListener(map, "dragstart", () => {
            gestured.current = true;
          }),
          maps.event.addListener(map, "zoom_changed", () => {
            if (!programmatic.current) gestured.current = true;
          }),
        );
        rememberOffers(initial);
        rememberRoute(initial);
        const resize = new ResizeObserver(() => {
          if (!mapRef.current || gestured.current) return;
          const current = props.current;
          if (!current.neighborhood && !followsActiveRoute()) return;
          const size = measuredMap();
          if (!size) return;
          const held = current.neighborhood ? heldOffers.current : heldRoute.current;
          if (
            held &&
            Math.abs(size.width - held.width) < 8 &&
            Math.abs(size.height - held.height) < 8
          )
            return;
          applyCamera(frameRef.current());
          drawRef.current();
        });
        resize.observe(element);
        listeners.push({ remove: () => resize.disconnect() });
        drawRef.current();
      })
      .catch(() => undefined);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pausePulseRef.current();
      else syncPulseRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      for (const listener of listeners) listener.remove();
      riderMarkerRef.current?.setMap(null);
      labelMarker.current?.setMap(null);
      deliveredMarker.current?.setMap(null);
      stopMarkerRef.current?.setMap(null);
      lineRef.current?.setMap(null);
      stopSearchPulse();
      const maps = mapsRef.current;
      if (maps && mapRef.current)
        maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    headingTrack.current = { heading: null, anchor: null };
    directionRef.current = null;
    motorcycleIconUrl.current = null;
    labelText.current = null;
  }, [deliveryId]);

  useEffect(() => {
    const destinationChanged = stopKeyRef.current !== stopKey;
    const identityChanged = framedIdentity.current !== deliveryId;
    stopKeyRef.current = stopKey;
    if (followsActiveRoute()) {
      const switchingDelivery = identityChanged && framedIdentity.current !== "";
      if (switchingDelivery) gestured.current = false;
      if (gestured.current) {
        drawRef.current();
        return;
      }
      if (
        props.current.hideRoute &&
        keepArrivalCamera(framedIdentity.current === deliveryId && heldRoute.current !== null)
      ) {
        drawRef.current();
        return;
      }
      const size = measuredMap();
      const bottom = sheetOverlap();
      const held = heldRoute.current;
      const sameSize =
        size !== null &&
        held !== null &&
        Math.abs(size.width - held.width) < 8 &&
        Math.abs(size.height - held.height) < 8 &&
        held.bottom === bottom;
      if (
        !identityChanged &&
        !destinationChanged &&
        sameSize &&
        size &&
        trackingFrameHolds(activeRoutePoints(), held.frame, size.width, size.height, bottom, cameraOptions())
      ) {
        drawRef.current();
        return;
      }
      if (!mapRef.current) return;
      framedIdentity.current = deliveryId;
      applyCamera(frameRef.current());
      drawRef.current();
      return;
    }
    const decision = trackingCameraShouldMove(
      destinationChanged,
      gestured.current,
    );
    gestured.current = decision.gestured;
    if (!decision.move) {
      drawRef.current();
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    if (
      props.current.neighborhood &&
      props.current.stop &&
      heldOffers.current
    ) {
      const size = measuredMap();
      const held = heldOffers.current;
      const sameSize =
        size !== null &&
        Math.abs(size.width - held.width) < 8 &&
        Math.abs(size.height - held.height) < 8;
      const points = [props.current.stop, ...props.current.extraMarkers];
      if (
        sameSize &&
        size &&
        offersFrameHolds(points, held.frame, size.width, size.height)
      ) {
        drawRef.current();
        return;
      }
    }
    applyCamera(frameRef.current());
    drawRef.current();
  }, [deliveryId, live, stopKey, markerKey, neighborhood, routeKey, riderShown, tagShown]);

  useEffect(() => {
    if (props.current.live && rider) followHeading(rider);
    drawRef.current();
  }, [
    deliveryId,
    rider?.latitude,
    rider?.longitude,
    rider?.bearingDegrees,
    headingToDropoff,
    hideRoute,
    summary,
    line.length,
    extraMarkers.length,
    pickup?.latitude,
    pickup?.longitude,
    deliveredCallout?.name,
    deliveredCallout?.address,
    deliveredCallout?.when,
    pickupLabel,
  ]);

  function followHeading(point: RiderMarkerPoint) {
    headingTrack.current = advanceMotorcycleHeading(
      headingTrack.current,
      point,
      point.bearingDegrees,
    );
  }

  function zoomForFrame(next: {
    latitudeDelta: number;
    longitudeDelta: number;
  }) {
    const height = node.current?.clientHeight || 480;
    const width = node.current?.clientWidth || height;
    const fitRoute = Boolean(props.current.pickup) && !props.current.live;
    if (!props.current.neighborhood && !fitRoute && !followsActiveRoute())
      return zoomForSpan(next.latitudeDelta, height);
    return Math.min(
      zoomForSpan(next.latitudeDelta, height),
      zoomForSpan(next.longitudeDelta, width),
    );
  }

  function measuredMap(): { width: number; height: number } | null {
    const width = node.current?.clientWidth ?? 0;
    const height = node.current?.clientHeight ?? 0;
    if (width < 40 || height < 40) return null;
    return { width, height };
  }

  function rememberOffers(frame: OffersMapFrame) {
    if (!props.current.neighborhood) {
      heldOffers.current = null;
      return;
    }
    const size = measuredMap();
    if (!size) return;
    heldOffers.current = { width: size.width, height: size.height, frame };
  }

  function rememberRoute(frame: OffersMapFrame) {
    if (!followsActiveRoute()) {
      heldRoute.current = null;
      return;
    }
    const size = measuredMap();
    if (!size) return;
    heldRoute.current = { width: size.width, height: size.height, bottom: sheetOverlap(), frame };
    framedIdentity.current = props.current.deliveryId;
  }

  function sheetOverlap(): number {
    const map = node.current;
    if (!map) return TRACKING_SHEET_OVERLAP;
    const sheet = map.closest(".track")?.querySelector(".track-sheet");
    if (!(sheet instanceof HTMLElement)) return TRACKING_SHEET_OVERLAP;
    const overlap = map.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
    if (!Number.isFinite(overlap)) return TRACKING_SHEET_OVERLAP;
    return Math.max(TRACKING_SHEET_OVERLAP, Math.round(overlap));
  }

  function cameraOptions() {
    const current = props.current;
    return {
      includeRider: current.rider !== null,
      includeTag: Boolean(current.live && current.rider && current.summary),
    };
  }

  function followsActiveRoute(): boolean {
    const current = props.current;
    if (current.neighborhood || current.deliveredCallout) return false;
    if (!current.live && current.pickup && current.stop) return false;
    return current.live || current.rider !== null || (current.line.length > 1 && current.stop !== null);
  }

  function activeRoutePoints(): RoutePoint[] {
    const current = props.current;
    const route = current.hideRoute
      ? []
      : trackingRoute(current.line, current.rider, current.stop, current.pickup);
    const points = [...route];
    if (current.rider) points.push(current.rider);
    if (current.stop) points.push(current.stop);
    return points;
  }

  function applyCamera(next: OffersMapFrame) {
    const map = mapRef.current;
    if (!map) return;
    programmatic.current = true;
    map.setCenter({ lat: next.latitude, lng: next.longitude });
    map.setZoom(zoomForFrame(next));
    programmatic.current = false;
    rememberOffers(next);
    rememberRoute(next);
  }

  function frame() {
    const current = props.current;
    if (current.neighborhood && current.stop) {
      const size = measuredMap() ?? { width: 360, height: 280 };
      return offersMapCamera(
        [current.stop, ...current.extraMarkers],
        size.width,
        size.height,
      );
    }
    if (!current.live && current.pickup && current.stop) {
      const fitted = trackingRoute(
        current.line,
        current.rider,
        current.stop,
        current.pickup,
      );
      const points = current.rider ? [...fitted, current.rider] : fitted;
      return routeCamera(
        points.length > 0 ? points : [current.pickup, current.stop],
      );
    }
    if (followsActiveRoute()) {
      const size = measuredMap() ?? { width: 360, height: TRACKING_MAP_HEIGHT };
      const points = activeRoutePoints();
      const fitted = trackingRouteCamera(
        points.length > 0 ? points : current.stop ? [current.stop] : [],
        size.width,
        size.height,
        sheetOverlap(),
        cameraOptions(),
      );
      if (!current.hideRoute) return fitted;
      return capTrackingCameraZoom(fitted, size.width, size.height, ARRIVAL_MAX_ZOOM);
    }
    if (current.rider && current.stop) return trackingCameraRegion(current.rider, current.stop);
    if (current.stop) return trackingCameraRegion(current.stop, null);
    return {
      latitude: -17.8292,
      longitude: 31.0522,
      latitudeDelta: 0.07,
      longitudeDelta: 0.07,
    };
  }

  function move(animated: boolean) {
    if (!mapRef.current || (gestured.current && !animated)) return;
    applyCamera(frame());
    void animated;
  }

  function draw() {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;
    const current = props.current;
    const route = current.hideRoute
      ? []
      : trackingRoute(
          current.line,
          current.rider,
          current.stop,
          current.pickup,
        );
    const path = route.map((point) => ({
      lat: point.latitude,
      lng: point.longitude,
    }));
    const strokeColor =
      current.stroke === "#17211D" &&
      document.documentElement.dataset.theme === "dark"
        ? "#F3F7F5"
        : current.stroke;
    const strokeWeight = current.pickup ? 5 : 4;
    if (!lineRef.current)
      lineRef.current = new maps.Polyline({
        map,
        path,
        strokeColor,
        strokeWeight,
      });
    else lineRef.current.setPath(path);
    drawPin(maps, map, pickupMarker, current.pickup, "Pickup", "#169B62");
    const callout = current.deliveredCallout;
    const pickupStop = !current.headingToDropoff;
    const stopIcon = pickupStop
      ? pickupPinIcon(maps, null)
      : pinIcon("#1A73E8");
    if (!current.stop || callout) {
      stopMarkerRef.current?.setMap(null);
      stopMarkerRef.current = null;
    } else if (!stopMarkerRef.current) {
      stopMarkerRef.current = new maps.Marker({
        map,
        position: { lat: current.stop.latitude, lng: current.stop.longitude },
        title: pickupStop ? (current.pickupLabel ?? "Pickup") : "Drop-off",
        zIndex: pickupStop && current.pickupLabel ? 4 : 1,
        icon: stopIcon,
      });
    } else {
      stopMarkerRef.current.setPosition({
        lat: current.stop.latitude,
        lng: current.stop.longitude,
      });
      stopMarkerRef.current.setIcon(stopIcon);
    }
    if (!callout || !current.stop) {
      deliveredMarker.current?.setMap(null);
      deliveredMarker.current = null;
    } else if (!deliveredMarker.current) {
      deliveredMarker.current = new maps.Marker({
        map,
        position: { lat: current.stop.latitude, lng: current.stop.longitude },
        title: "Delivered",
        clickable: false,
        zIndex: 4,
        icon: deliveredMarkerIcon(maps, callout),
      });
    } else {
      deliveredMarker.current.setPosition({
        lat: current.stop.latitude,
        lng: current.stop.longitude,
      });
      deliveredMarker.current.setIcon(deliveredMarkerIcon(maps, callout));
      deliveredMarker.current.setMap(map);
    }
    const label = current.live && current.rider ? current.summary : null;
    const labelKey = label == null ? null : `${document.documentElement.dataset.theme === "dark" ? "dark" : "light"}:${label}`;
    if (!label || !labelKey || !current.rider) {
      labelMarker.current?.setMap(null);
      labelMarker.current = null;
      labelText.current = null;
    } else if (!labelMarker.current) {
      labelText.current = labelKey;
      labelMarker.current = new maps.Marker({
        map,
        position: { lat: current.rider.latitude, lng: current.rider.longitude },
        clickable: false,
        zIndex: 4,
        icon: summaryIcon(maps, label),
      });
    } else {
      labelMarker.current.setPosition({
        lat: current.rider.latitude,
        lng: current.rider.longitude,
      });
      if (labelText.current !== labelKey) {
        labelText.current = labelKey;
        labelMarker.current.setIcon(summaryIcon(maps, label));
      }
      labelMarker.current.setMap(map);
    }
    const direction =
      motorcycleDirection(current.live ? headingTrack.current.heading : null, directionRef.current) ?? "north";
    directionRef.current = direction;
    const motorcycleUrl = DIRECTIONAL_MOTORCYCLE_ICONS[direction];
    if (!current.rider) {
      riderMarkerRef.current?.setMap(null);
      riderMarkerRef.current = null;
      motorcycleIconUrl.current = null;
    } else if (!riderMarkerRef.current) {
      motorcycleIconUrl.current = motorcycleUrl;
      riderMarkerRef.current = new maps.Marker({
        map,
        position: { lat: current.rider.latitude, lng: current.rider.longitude },
        title: current.summary
          ? `Rider location, ${current.summary}`
          : "Rider location",
        clickable: false,
        optimized: false,
        zIndex: 3,
        rotation: 0,
        icon: squareMotorcycleMarkerIcon(maps, motorcycleUrl, TRACKING_MOTORCYCLE_WIDTH),
      });
    } else {
      riderMarkerRef.current.setPosition({
        lat: current.rider.latitude,
        lng: current.rider.longitude,
      });
      if (motorcycleIconUrl.current !== motorcycleUrl) {
        motorcycleIconUrl.current = motorcycleUrl;
        riderMarkerRef.current.setIcon(squareMotorcycleMarkerIcon(maps, motorcycleUrl, TRACKING_MOTORCYCLE_WIDTH));
        riderMarkerRef.current.setOptions({ rotation: 0 });
      }
      riderMarkerRef.current.setMap(map);
    }
    const seenExtras = new Set<string>();
    current.extraMarkers.forEach((point, index) => {
      const id = point.id ?? `${point.latitude},${point.longitude}`;
      seenExtras.add(id);
      const position = { lat: point.latitude, lng: point.longitude };
      const existing = extras.current.get(id);
      if (existing) {
        existing.setPosition(position);
        existing.setMap(map);
        return;
      }
      extras.current.set(id, new maps.Marker({
        map,
        position,
        title: point.title,
        clickable: false,
        optimized: false,
        zIndex: 3,
        rotation: 0,
        icon: squareMotorcycleMarkerIcon(
          maps,
          directionalMotorcycleUrl(point.id ?? `extra-${index}`),
          TRACKING_MOTORCYCLE_WIDTH,
        ),
      }));
    });
    for (const [id, marker] of extras.current) {
      if (seenExtras.has(id)) continue;
      marker.setMap(null);
      extras.current.delete(id);
    }
    syncSearchPulse();
  }

  function pauseSearchPulse() {
    if (pulseTimer.current === null) return;
    window.clearInterval(pulseTimer.current);
    pulseTimer.current = null;
    pulseElapsed.current = performance.now() - pulseStarted.current;
  }

  function stopSearchPulse() {
    if (pulseTimer.current !== null) {
      window.clearInterval(pulseTimer.current);
      pulseTimer.current = null;
    }
    pulseElapsed.current = 0;
    for (const circle of pulseCircles.current) circle.setMap(null);
    pulseCircles.current = [];
  }

  function syncSearchPulse() {
    const maps = mapsRef.current;
    const map = mapRef.current;
    const current = props.current;
    if (!maps || !map || !current.neighborhood || !current.stop) {
      stopSearchPulse();
      return;
    }
    if (document.visibilityState === "hidden") {
      pauseSearchPulse();
      return;
    }
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const tick = () => {
      const liveMap = mapRef.current;
      const latest = props.current;
      if (
        !mapsRef.current ||
        !liveMap ||
        !latest.neighborhood ||
        !latest.stop
      ) {
        stopSearchPulse();
        return;
      }
      const progress = reduceMotion
        ? 0
        : ((performance.now() - pulseStarted.current) % SEARCH_PULSE_MS) /
          SEARCH_PULSE_MS;
      const rings = searchPulseRings(progress, reduceMotion);
      while (pulseCircles.current.length < rings.length) {
        pulseCircles.current.push(
          new maps.Circle({
            map: liveMap,
            center: { lat: latest.stop.latitude, lng: latest.stop.longitude },
            radius: 140,
            clickable: false,
            zIndex: 0,
          }),
        );
      }
      while (pulseCircles.current.length > rings.length) {
        pulseCircles.current.pop()?.setMap(null);
      }
      rings.forEach((ring, index) => {
        const circle = pulseCircles.current[index];
        if (!circle || !latest.stop) return;
        circle.setCenter({
          lat: latest.stop.latitude,
          lng: latest.stop.longitude,
        });
        circle.setRadius(ring.radius);
        circle.setOptions({
          fillColor: "#169B62",
          fillOpacity: ring.opacity,
          strokeColor: "#169B62",
          strokeOpacity: Math.min(1, ring.opacity * 1.7),
          strokeWeight: 2,
        });
      });
    };
    if (reduceMotion) {
      pauseSearchPulse();
      tick();
      return;
    }
    if (pulseTimer.current !== null) return;
    pulseStarted.current = performance.now() - pulseElapsed.current;
    tick();
    pulseTimer.current = window.setInterval(tick, SEARCH_PULSE_FRAME_MS);
  }
  pausePulseRef.current = pauseSearchPulse;
  syncPulseRef.current = syncSearchPulse;

  function drawPin(
    maps: Maps,
    map: GoogleMap,
    slot: { current: Marker | null },
    point: RoutePoint | null,
    title: string,
    color: string,
  ) {
    if (!point) {
      slot.current?.setMap(null);
      slot.current = null;
      return;
    }
    const icon =
      color.toLowerCase() === "#169b62"
        ? pickupPinIcon(maps, null)
        : pinIcon(color);
    if (!slot.current) {
      slot.current = new maps.Marker({
        map,
        position: { lat: point.latitude, lng: point.longitude },
        title,
        icon,
      });
      return;
    }
    slot.current.setPosition({ lat: point.latitude, lng: point.longitude });
    slot.current.setIcon(icon);
  }

  return (
    <div className="track-map">
      <div ref={node} className="track-map-canvas" />
      <button
        type="button"
        className="track-recenter"
        aria-label="Recenter map"
        onClick={() => {
          gestured.current = false;
          move(true);
        }}
      >
        <CrosshairIcon />
      </button>
    </div>
  );
}

type DeliveredCallout = { name: string; address: string; when: string };

function deliveredMarkerIcon(maps: Maps, callout: DeliveredCallout) {
  const padX = 16;
  const lineH = 22;
  const nameLines = wrapDeliveredAddress(callout.name, 27);
  const addressLines = wrapDeliveredAddress(callout.address, 27);
  const details = [
    ...nameLines.map((value) => ({ value, bold: true })),
    ...addressLines.map((value) => ({ value, bold: false })),
    ...(callout.when ? [{ value: callout.when, bold: false }] : []),
  ];
  // Size the card to its contents, keeping matching horizontal padding.
  const maxLineLength = Math.max(20, ...details.map(({ value }) => value.length));
  const width = Math.max(205, Math.min(280, Math.ceil(maxLineLength * 7.5) + padX * 2));
  const detailStartY = 57;
  const cardH = detailStartY + Math.max(0, details.length - 1) * lineH + 18;
  const pin = 46;
  const gap = 6;
  const height = cardH + gap + pin;
  const text = [
    `<circle cx="${padX + 12}" cy="25" r="11" fill="#ffffff"/>`,
    `<path d="M${padX + 6} 25l4 4 8-9" fill="none" stroke="#16845B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="${padX + 32}" y="31" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#ffffff">Delivered</text>`,
  ];
  details.forEach(({ value, bold }, index) => {
    text.push(`<text x="${padX}" y="${detailStartY + index * lineH}" font-family="Arial, sans-serif" font-size="16" font-weight="${bold ? '600' : '400'}" fill="#ffffff">${escapeXml(value)}</text>`);
  });
  // Reuse the existing destination pin artwork and its 46px size.
  const destinationPin = `<path fill="#1A73E8" d="M12 2.2a6.2 6.2 0 0 0-6.2 6.2c0 4.2 6.2 10.2 6.2 10.2s6.2-6 6.2-10.2A6.2 6.2 0 0 0 12 2.2z"/><text x="12" y="11.7" text-anchor="middle" font-family="Arial, sans-serif" font-size="8.5" font-weight="700" fill="#ffffff">2</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="2" y="3" width="${width - 4}" height="${cardH}" rx="18" fill="#17211D" opacity="0.18"/><rect width="${width}" height="${cardH}" rx="18" fill="#16845B"/>${text.join('')}<svg x="${(width - pin) / 2}" y="${cardH + gap}" width="${pin}" height="${pin}" viewBox="0 0 24 24">${destinationPin}</svg></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(width, height),
    anchor: new maps.Point(width / 2, height - 10),
  };
}

function wrapDeliveredAddress(value: string, maxCharacters: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharacters && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function trackingRoute(
  line: RoutePoint[],
  rider: RoutePoint | null,
  stop: RoutePoint | null,
  pickup: RoutePoint | null,
): RoutePoint[] {
  if (showsTrackingRoute(line.length)) return line;
  if (rider && stop) return [rider, stop];
  if (pickup && stop) return [pickup, stop];
  return [];
}

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
  const latitudeDelta = Math.max(
    maxLatitude - minLatitude,
    TRACKING_ZOOM_DELTA,
  );
  const longitudeDelta = Math.max(
    maxLongitude - minLongitude,
    TRACKING_ZOOM_DELTA,
  );
  const openHeight =
    TRACKING_MAP_HEIGHT - TRACKING_SHEET_OVERLAP - TRACKING_MARKER_CLEARANCE;
  const liftedLatitudeDelta =
    latitudeDelta * (TRACKING_MAP_HEIGHT / openHeight);
  const openCenter = TRACKING_MARKER_CLEARANCE + openHeight / 2;
  const southOfCenter =
    (TRACKING_MAP_HEIGHT / 2 - openCenter) / TRACKING_MAP_HEIGHT;
  return {
    latitude:
      (minLatitude + maxLatitude) / 2 - southOfCenter * liftedLatitudeDelta,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: liftedLatitudeDelta,
    longitudeDelta,
  };
}

function summaryIcon(maps: Maps, text: string) {
  const arrived = text === PICKUP_ARRIVED_TAG;
  const dark = document.documentElement.dataset.theme === "dark";
  const fill = arrived ? "#169B62" : dark ? "#101614" : "#ffffff";
  const ink = arrived ? "#ffffff" : dark ? "#F3F7F5" : "#17211D";
  const width = Math.min(220, Math.max(72, Math.round(text.length * 7.2) + 16));
  const pillHeight = 24;
  const shadow = arrived ? 3 : 0;
  const height = pillHeight + shadow;
  const shadowRect = arrived
    ? `<rect y="${shadow}" width="${width}" height="${pillHeight}" rx="12" fill="#3317211D"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shadowRect}<rect width="${width}" height="${pillHeight}" rx="12" fill="${fill}"/><text x="${width / 2}" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="${ink}">${escapeXml(text)}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(width, height),
    anchor: new maps.Point(width / 2, pillHeight + 70),
  };
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

const PICKUP_PIN = 46;

function pickupPinMarkup(): string {
  return `<path fill="#169B62" d="M12 2.2a6.2 6.2 0 0 0-6.2 6.2c0 4.2 6.2 10.2 6.2 10.2s6.2-6 6.2-10.2A6.2 6.2 0 0 0 12 2.2z"/><text x="12" y="11.7" text-anchor="middle" font-family="Arial, sans-serif" font-size="8.5" font-weight="700" fill="#ffffff">1</text>`;
}

function pickupPinIcon(maps: Maps, label: string | null) {
  if (!label) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PICKUP_PIN}" height="${PICKUP_PIN}" viewBox="0 0 24 24">${pickupPinMarkup()}</svg>`;
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new maps.Size(PICKUP_PIN, PICKUP_PIN),
      anchor: new maps.Point(PICKUP_PIN / 2, 36),
    };
  }
  const dark = document.documentElement.dataset.theme === "dark";
  const width = Math.max(PICKUP_PIN, Math.round(label.length * 7.1) + 20);
  const labelHeight = 28;
  const gap = 6;
  const height = labelHeight + gap + PICKUP_PIN;
  const background = dark ? "#1A2420" : "#ffffff";
  const text = dark ? "#F3F7F5" : "#17211D";
  const shadow = dark ? "rgba(0,0,0,0.45)" : "rgba(23,33,29,0.16)";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="1" y="2" width="${width - 2}" height="${labelHeight}" rx="11" fill="${shadow}"/><rect width="${width}" height="${labelHeight}" rx="11" fill="${background}"/><text x="${width / 2}" y="18" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="600" fill="${text}">${escapeXml(label)}</text><svg x="${(width - PICKUP_PIN) / 2}" y="${labelHeight + gap}" width="${PICKUP_PIN}" height="${PICKUP_PIN}" viewBox="0 0 24 24">${pickupPinMarkup()}</svg></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(width, height),
    anchor: new maps.Point(width / 2, labelHeight + gap + 36),
  };
}

function pinIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 24 24"><path fill="${color}" d="M12 2.2a6.2 6.2 0 0 0-6.2 6.2c0 4.2 6.2 10.2 6.2 10.2s6.2-6 6.2-10.2A6.2 6.2 0 0 0 12 2.2z"/><text x="12" y="11.7" text-anchor="middle" font-family="Arial, sans-serif" font-size="8.5" font-weight="700" fill="#ffffff">2</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    anchor: { x: 23, y: 36 },
  };
}
