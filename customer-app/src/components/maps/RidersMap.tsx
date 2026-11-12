import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Details } from 'react-native-maps';
import RiderMotorcycleMarker from './RiderMotorcycleMarker';
import { deliveryIcon } from '../../features/deliveries/presentation/deliveryIcons';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import { HOME_NEIGHBORHOOD_DELTA, customerNeighborhoodFrame, frameContainsPoints, nearbyMapFrame, type NearbyMapFrame } from '../../features/riders/domain/nearbyMapFrame';
import PickupSearchPulse from './PickupSearchPulse';

export type RidersMapPoint = { latitude: number; longitude: number };

type Props = {
  customerLocation: RidersMapPoint | null;
  /** Only pass locations authorized for customer display. Never fabricate rider coordinates. */
  riders?: ReadonlyArray<RidersMapPoint & { id: string }>;
  /** Hide the customer location marker while still centering the map on the customer. */
  showCustomerMarker?: boolean;
  /** Optional delivery pickup marker for the waiting-for-offers map. */
  pickupLocation?: RidersMapPoint | null;
  /** Disable gestures when embedded in a scrolling details screen. */
  interactive?: boolean;
  /** Height of a sheet covering the bottom of the map. Applied only after the native map exists. */
  bottomPadding?: number;
  /** Home camera: about 3 km above the sheet, never tightened by one nearby rider. */
  neighborhoodView?: boolean;
  /** Home background: frame the first valid customer fix once and do not follow later GPS or rider updates. */
  stableNeighborhood?: boolean;
  /** Radar rings on the pickup while a rider is still being found. */
  searchPulse?: boolean;
};

const DEFAULT_REGION = { latitude: -17.8292, longitude: 31.0522, latitudeDelta: 0.07, longitudeDelta: 0.07 };

export default function RidersMap({ customerLocation, riders = [], showCustomerMarker = true, pickupLocation = null, interactive = true, bottomPadding = 0, neighborhoodView = false, stableNeighborhood = false, searchPulse = false }: Props) {
  const mapRef = useRef<MapView>(null);
  const mounted = useRef(true);
  const mapReady = useRef(false);
  const gestured = useRef(false);
  const framed = useRef<string | null>(null);
  const neighborhoodFrame = useRef<NearbyMapFrame | null>(null);
  const lockedCustomer = useRef<RidersMapPoint | null>(null);
  const framedPadding = useRef<number | null>(null);
  const [paddingReady, setPaddingReady] = useState(false);
  const customerRef = useRef(customerLocation);
  const ridersRef = useRef(riders);
  const paddingRef = useRef(bottomPadding);
  customerRef.current = customerLocation;
  ridersRef.current = riders;
  paddingRef.current = bottomPadding;
  const hasCustomer = customerLocation !== null;
  const hasRiders = riders.length > 0;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const moveCamera = (animated: boolean) => {
    const map = mapRef.current;
    if (!mounted.current || !mapReady.current || !map) return;
    const shown = ridersRef.current;
    const customer = customerRef.current;
    if (neighborhoodView && stableNeighborhood) {
      const frame = customerNeighborhoodFrame(lockedCustomer.current ?? customer);
      if (!frame) return;
      lockedCustomer.current = { latitude: frame.latitude, longitude: frame.longitude };
      map.animateToRegion(frame, animated ? 350 : 1);
      return;
    }
    if (neighborhoodView) {
      const frame = nearbyMapFrame(customer, shown);
      if (!frame) return;
      neighborhoodFrame.current = frame;
      framedPadding.current = paddingRef.current;
      map.animateToRegion(frame, animated ? 350 : 1);
      return;
    }
    if (shown.length > 0) {
      const coordinates = customer ? [customer, ...shown] : [...shown];
      map.fitToCoordinates(coordinates, {
        edgePadding: { top: 64, right: 32, bottom: 24, left: 32 },
        animated,
      });
      return;
    }
    if (!customer) return;
    map.animateToRegion({ ...customer, latitudeDelta: 0.025, longitudeDelta: 0.025 }, animated ? 350 : 1);
  };

  const tryFit = (animated: boolean) => {
    if (!mounted.current || gestured.current || !mapReady.current) return;
    if (neighborhoodView && stableNeighborhood) {
      if (paddingRef.current <= 0) return;
      if (!animated && lockedCustomer.current) return;
      moveCamera(animated);
      return;
    }
    if (neighborhoodView) {
      if (paddingRef.current <= 0) return;
      const points = customerRef.current ? [customerRef.current, ...ridersRef.current] : [...ridersRef.current];
      const held = neighborhoodFrame.current;
      const paddingSettled = held !== null && framedPadding.current !== null && Math.abs(paddingRef.current - framedPadding.current) < 48;
      if (held && paddingSettled && frameContainsPoints(held, points)) return;
      moveCamera(animated);
      return;
    }
    const signature = `${paddingRef.current}:${customerRef.current ? 1 : 0}:${ridersRef.current.length > 0 ? 1 : 0}`;
    if (framed.current === signature) return;
    moveCamera(animated);
    if (!customerRef.current && ridersRef.current.length === 0) return;
    framed.current = signature;
  };

  useEffect(() => {
    tryFit(false);
  }, [bottomPadding, hasCustomer, hasRiders, paddingReady]);

  const recenter = () => {
    if (!mounted.current) return;
    gestured.current = false;
    framed.current = null;
    neighborhoodFrame.current = null;
    framedPadding.current = null;
    lockedCustomer.current = stableNeighborhood ? customerRef.current : null;
    tryFit(true);
  };

  const rememberGesture = (_region: unknown, details: Details) => {
    if (details?.isGesture) gestured.current = true;
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={customerLocation ? { ...customerLocation, latitudeDelta: neighborhoodView ? HOME_NEIGHBORHOOD_DELTA : 0.025, longitudeDelta: neighborhoodView ? HOME_NEIGHBORHOOD_DELTA : 0.025 } : DEFAULT_REGION}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={interactive}
        pitchEnabled={interactive}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        {...(paddingReady ? { mapPadding: { top: 48, right: 24, bottom: bottomPadding, left: 24 } } : {})}
        onMapReady={() => {
          mapReady.current = true;
          setPaddingReady(true);
        }}
        onRegionChangeComplete={rememberGesture}
      >
        {showCustomerMarker && customerLocation ? (
          <Marker coordinate={customerLocation} tracksViewChanges={false} title="Your location">
            <View style={styles.locationRing}><View style={styles.locationDot} /></View>
          </Marker>
        ) : null}
        {searchPulse && pickupLocation ? (
          <PickupSearchPulse coordinate={pickupLocation} active />
        ) : null}
        {pickupLocation ? (
          <Marker coordinate={pickupLocation} title="Parcel pickup" anchor={{ x: 0.5, y: 1 }} zIndex={searchPulse ? 2 : 1}>
            <View collapsable={false} style={styles.pickupPin}>
              <View collapsable={false} style={styles.pickupPinCenter} />
              <MaterialDesignIcons name="map-marker" size={36} color={deliveryIcon.pickup} style={styles.pickupGlyph} />
            </View>
          </Marker>
        ) : null}
        {riders.map((rider) => (
          <RiderMotorcycleMarker
            key={rider.id}
            coordinate={rider}
            accessibilityLabel="Available rider"
          />
        ))}
      </MapView>
      {customerLocation ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Recenter map" onPress={recenter} style={[styles.recenter, { bottom: bottomPadding + 18 }]}>
          <MaterialDesignIcons name="crosshairs-gps" size={22} color="#263F34" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  locationRing: { width: 27, height: 27, borderRadius: 14, backgroundColor: 'rgba(42,134,240,0.17)', alignItems: 'center', justifyContent: 'center' },
  locationDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: '#2885E9', borderWidth: 2, borderColor: '#FFFFFF' },
  pickupPin: { width: 36, height: 36 },
  pickupPinCenter: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', left: 13, top: 8.5 },
  pickupGlyph: { width: 36, height: 36, lineHeight: 36, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
  recenter: { position: 'absolute', right: 20, width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8 },
});
