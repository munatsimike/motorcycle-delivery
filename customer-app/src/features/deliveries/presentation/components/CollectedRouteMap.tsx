import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Details } from 'react-native-maps';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import { apiGet } from '../../../../services/api/apiClient';
import { deliveryIcon } from '../deliveryIcons';
import { fittedRouteRegion, type CameraPoint, type CameraRegion } from '../../domain/trackingCamera';

type MapPoint = {
  latitude: number;
  longitude: number;
};

type CollectedRouteMapProps = {
  deliveryId: string;
  accessToken: string | null;
  pickup: MapPoint;
  dropoff: MapPoint;
};

const MIN_MAP_WIDTH = 200;
const MIN_MAP_HEIGHT = 280;
const ROUTE_BLUE = deliveryIcon.dropoff;

export default function CollectedRouteMap({ deliveryId, accessToken, pickup, dropoff }: CollectedRouteMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const gestured = useRef(false);
  const applied = useRef<string | null>(null);
  const mapSize = useRef({ width: 0, height: 0 });
  const [line, setLine] = useState<MapPoint[]>([pickup, dropoff]);
  const region = routeRegion(line);
  const regionKey = regionKeyOf(region);
  const regionRef = useRef(region);
  const regionKeyRef = useRef(regionKey);
  regionRef.current = region;
  regionKeyRef.current = regionKey;

  useEffect(() => {
    let cancelled = false;
    if (!accessToken) {
      return undefined;
    }
    void apiGet<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/route`, { accessToken })
      .then((body) => {
        const road = readRouteLine(body);
        if (!cancelled && road.length > 1) {
          setLine(road);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accessToken, deliveryId]);

  function moveCamera(animated: boolean) {
    const next = regionRef.current;
    const key = regionKeyRef.current;
    if (!mapRef.current || mapSize.current.width < MIN_MAP_WIDTH || mapSize.current.height < MIN_MAP_HEIGHT) {
      return;
    }
    if (!animated && (gestured.current || applied.current === key)) {
      return;
    }
    mapRef.current.animateToRegion(next, animated ? 250 : 1);
    applied.current = key;
  }

  useEffect(() => {
    moveCamera(false);
  }, [regionKey]);

  function rememberSize(width: number, height: number) {
    if (width < 1 || height < 1 || (mapSize.current.width === width && mapSize.current.height === height)) {
      return;
    }
    mapSize.current = { width, height };
    moveCamera(false);
  }

  function recenter() {
    gestured.current = false;
    applied.current = null;
    moveCamera(true);
  }

  function rememberGesture(_region: unknown, details: Details) {
    if (details?.isGesture) {
      gestured.current = true;
    }
  }

  return (
    <View style={styles.frame}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={region}
        scrollEnabled
        zoomEnabled
        pitchEnabled={false}
        rotateEnabled={false}
        toolbarEnabled={false}
        loadingEnabled
        onMapReady={() => moveCamera(false)}
        onLayout={(event) => rememberSize(event.nativeEvent.layout.width, event.nativeEvent.layout.height)}
        onRegionChangeComplete={rememberGesture}
      >
        {line.length > 1 ? (
          <Polyline coordinates={line} strokeColor={ROUTE_BLUE} strokeWidth={5} />
        ) : null}
        <Marker coordinate={pickup} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} zIndex={1}>
          <MaterialDesignIcons name="map-marker" size={36} color={deliveryIcon.pickup} />
        </Marker>
        <Marker coordinate={dropoff} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} zIndex={2}>
          <MaterialDesignIcons name="map-marker" size={36} color={deliveryIcon.dropoff} />
        </Marker>
      </MapView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Recenter map"
        onPress={recenter}
        style={styles.recenter}
      >
        <MaterialDesignIcons name="crosshairs-gps" size={22} color="#263F34" />
      </Pressable>
    </View>
  );
}

function routeRegion(points: MapPoint[]): CameraRegion {
  const corners = extremes(points);
  return fittedRouteRegion(corners.southWest, corners.northEast);
}

function extremes(points: MapPoint[]): { southWest: CameraPoint; northEast: CameraPoint } {
  let southWest = points[0];
  let northEast = points[0];
  for (const point of points) {
    southWest = {
      latitude: Math.min(southWest.latitude, point.latitude),
      longitude: Math.min(southWest.longitude, point.longitude),
    };
    northEast = {
      latitude: Math.max(northEast.latitude, point.latitude),
      longitude: Math.max(northEast.longitude, point.longitude),
    };
  }
  return { southWest, northEast };
}

function regionKeyOf(region: CameraRegion): string {
  return [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta].map((value) => value.toFixed(5)).join(':');
}

export function readRouteLine(value: unknown): MapPoint[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const line = (value as { line?: unknown }).line;
  if (!Array.isArray(line)) {
    return [];
  }
  return line.flatMap((point) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
      return [];
    }
    const latitude = Number((point as { latitude?: unknown }).latitude);
    const longitude = Number((point as { longitude?: unknown }).longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return [];
    }
    return [{ latitude, longitude }];
  });
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
  recenter: {
    position: 'absolute',
    right: 16,
    bottom: 88,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    elevation: 3,
  },
});
