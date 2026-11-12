import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Details } from 'react-native-maps';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import { colors, radius, spacing, typography } from '../../../../theme';
import { trackingCameraRegion } from '../../domain/trackingCamera';
import { deliveryIcon } from '../deliveryIcons';

type MapPoint = {
  latitude: number;
  longitude: number;
};

type RiderLocationMapProps = {
  deliveryId: string;
  live: boolean;
  rider: MapPoint | null;
  stop: MapPoint | null;
  headingToDropoff: boolean;
  line: MapPoint[];
  distanceLabel: string | null;
  etaLabel: string | null;
};

const MIN_MAP_WIDTH = 200;
const MIN_MAP_HEIGHT = 280;
/** Same downward offset as the rider app's distance label bitmap. */
const LABEL_SHADOW_OFFSET = 3;
const LABEL_ANCHOR_Y = 1.55;

export default function RiderLocationMap({
  deliveryId,
  live,
  rider,
  stop,
  headingToDropoff,
  line,
  distanceLabel,
  etaLabel,
}: RiderLocationMapProps) {
  const summary = live ? riderSummary(distanceLabel, etaLabel) : null;
  const [labelAnchorY, setLabelAnchorY] = useState(LABEL_ANCHOR_Y);
  const mapRef = useRef<MapView | null>(null);
  const gestured = useRef(false);
  const applied = useRef<string | null>(null);
  const mapSize = useRef({ width: 0, height: 0 });
  const region = live && rider
    ? trackingCameraRegion(rider, stop)
    : stop
      ? trackingCameraRegion(stop, null)
      : null;
  const regionKey = region
    ? [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta].map((value) => value.toFixed(5)).join(':')
    : '';
  const regionRef = useRef(region);
  const regionKeyRef = useRef(regionKey);
  regionRef.current = region;
  regionKeyRef.current = regionKey;
  const stopKey = stop ? `${stop.latitude.toFixed(5)}:${stop.longitude.toFixed(5)}` : '';
  const stopKeyRef = useRef(stopKey);

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
    const destinationChanged = stopKeyRef.current !== stopKey;
    stopKeyRef.current = stopKey;
    if (destinationChanged && gestured.current) {
      return;
    }
    if (!destinationChanged) {
      gestured.current = false;
    }
    applied.current = null;
    moveCamera(destinationChanged);
  }, [deliveryId, live, stopKey]);

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
        {stop ? (
          <Marker
            coordinate={stop}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            zIndex={1}
            accessibilityLabel={headingToDropoff ? 'Drop-off' : 'Pickup'}
          >
            <MaterialDesignIcons
              name="map-marker"
              size={36}
              color={headingToDropoff ? deliveryIcon.dropoff : deliveryIcon.pickup}
            />
          </Marker>
        ) : null}
        {live && rider && summary ? (
          <Marker coordinate={rider} anchor={{ x: 0.5, y: labelAnchorY }} tracksViewChanges={false} zIndex={4}>
            <View
              collapsable={false}
              style={styles.riderLabelWrap}
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                const pill = height - LABEL_SHADOW_OFFSET;
                const next = pill > 0 ? (LABEL_ANCHOR_Y * pill) / height : LABEL_ANCHOR_Y;
                setLabelAnchorY((current) => (Math.abs(current - next) < 0.01 ? current : next));
              }}
            >
              <View style={styles.riderLabelShade} />
              <View style={styles.riderLabel}>
                <Text style={styles.riderSummary}>{summary}</Text>
              </View>
            </View>
          </Marker>
        ) : null}
        {live && rider ? (
          <Marker
            coordinate={rider}
            image={require('../../../../components/maps/rider_motorcycle_yellow_box.png')}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={3}
            accessibilityLabel="Rider location"
          />
        ) : null}
      </MapView>
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
      ) : null}
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
    flex: 1,
    height: '100%',
    backgroundColor: colors.surface,
  },
  mapWrap: {
    flex: 1,
    height: '100%',
    width: '100%',
  },
  map: {
    width: '100%',
    height: '100%',
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
  fallback: {
    padding: spacing.lg,
    color: colors.textSecondary,
    fontSize: typography.body,
  },
  riderLabelWrap: {
    paddingBottom: LABEL_SHADOW_OFFSET,
  },
  riderLabelShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: LABEL_SHADOW_OFFSET,
    bottom: 0,
    borderRadius: radius.md,
    backgroundColor: 'rgba(23, 33, 29, 0.2)',
  },
  riderLabel: {
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  riderSummary: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '700',
    lineHeight: 18,
  },
});

function riderSummary(distance: string | null, eta: string | null): string | null {
  const parts = [distance, eta].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

