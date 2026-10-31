import { Component, useEffect, useRef, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Details } from 'react-native-maps';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import { colors, radius, spacing, typography } from '../../../../theme';
import { trackingCameraRegion } from '../../domain/trackingCamera';

type MapPoint = {
  latitude: number;
  longitude: number;
};

type RiderLocationMapProps = {
  deliveryId: string;
  live: boolean;
  rider: MapPoint | null;
  pickup: MapPoint | null;
  line: MapPoint[];
  distanceLabel: string | null;
};

const MIN_MAP_WIDTH = 200;
const MIN_MAP_HEIGHT = 280;

export default function RiderLocationMap({
  deliveryId,
  live,
  rider,
  pickup,
  line,
  distanceLabel,
}: RiderLocationMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const gestured = useRef(false);
  const applied = useRef<string | null>(null);
  const mapSize = useRef({ width: 0, height: 0 });
  const region = live && rider
    ? trackingCameraRegion(rider, pickup)
    : pickup
      ? trackingCameraRegion(pickup, null)
      : null;
  const regionKey = region
    ? [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta].map((value) => value.toFixed(5)).join(':')
    : '';
  const regionRef = useRef(region);
  const regionKeyRef = useRef(regionKey);
  regionRef.current = region;
  regionKeyRef.current = regionKey;

  function moveCamera(animated: boolean) {
    const next = regionRef.current;
    const key = regionKeyRef.current;
    if (!next || !mapRef.current || mapSize.current.width < MIN_MAP_WIDTH || mapSize.current.height < MIN_MAP_HEIGHT) {
      return;
    }
    if (!animated && (gestured.current || applied.current === key)) {
      return;
    }
    mapRef.current.animateToRegion(next, animated ? 250 : 1);
    applied.current = key;
  }

  useEffect(() => {
    gestured.current = false;
    applied.current = null;
    moveCamera(false);
  }, [deliveryId, live]);

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
      {region ? (
      <MapBoundary fallback={<Text style={styles.fallback}>The live map needs an updated app build.</Text>}>
      <View
        style={styles.mapWrap}
        pointerEvents="box-none"
        collapsable={false}
        onLayout={(event) => rememberSize(event.nativeEvent.layout.width, event.nativeEvent.layout.height)}
      >
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
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
        {live && line.length > 1 ? (
          <Polyline coordinates={line} strokeColor={colors.text} strokeWidth={4} />
        ) : null}
        {pickup ? (
          <Marker coordinate={pickup} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
            <MaterialDesignIcons name="map-marker" size={36} color={colors.primary} />
          </Marker>
        ) : null}
        {live && rider ? (
        <Marker coordinate={rider} anchor={{ x: 0.5, y: 0.9 }} tracksViewChanges={false}>
          <View collapsable={false} style={styles.riderMarker} accessibilityLabel="Rider location">
            {distanceLabel ? <Text style={styles.distance}>{distanceLabel}</Text> : null}
            <View style={styles.bike}>
              <MaterialDesignIcons name="motorbike" size={20} color={colors.textInverse} />
            </View>
          </View>
        </Marker>
        ) : null}
      </MapView>
      {live ? null : (
        <View pointerEvents="none" style={styles.unavailable}>
          <Text style={styles.unavailableTitle}>Rider location unavailable</Text>
          <Text style={styles.unavailableBody}>Waiting for the rider's location to update.</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Recenter map"
        onPress={recenter}
        style={styles.recenter}
      >
        <MaterialDesignIcons name="crosshairs-gps" size={22} color={colors.text} />
      </Pressable>
      </View>
      </MapBoundary>
      ) : (
        <View pointerEvents="none" style={styles.unavailable}>
          <Text style={styles.unavailableTitle}>Rider location unavailable</Text>
          <Text style={styles.unavailableBody}>Waiting for the rider's location to update.</Text>
        </View>
      )}
    </View>
  );
}

class MapBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const styles = StyleSheet.create({
  frame: {
    height: 320,
    backgroundColor: colors.surface,
  },
  mapWrap: {
    height: 320,
    width: '100%',
  },
  map: {
    height: 320,
    width: '100%',
  },
  recenter: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 120 + spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  unavailable: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    right: spacing.lg,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 2,
  },
  unavailableTitle: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  unavailableBody: {
    color: colors.textSecondary,
    fontSize: typography.small,
    lineHeight: 18,
  },
  fallback: {
    padding: spacing.lg,
    color: colors.textSecondary,
    fontSize: typography.body,
  },
  riderMarker: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  distance: {
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  bike: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDark,
  },
});
