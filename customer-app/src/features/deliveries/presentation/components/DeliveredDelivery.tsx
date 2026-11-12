import { Component, useEffect, useRef, useState, type ReactNode, useMemo } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Marker, PROVIDER_GOOGLE, type Details, type Region } from 'react-native-maps';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ErrorMessage from '../../../../components/ErrorMessage';
import type { Palette } from '../../../../theme';
import { radius, spacing, typography, useAppearance, useGoogleMapStyle } from '../../../../theme';
import { deliveryCardAddress, deliveryContentKind, deliveryWhenLabel, shortDeliveryReference } from '../../domain/deliveryCard';
import { moneyLabel } from '../../domain/moneyLabel';
import type { CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { riderDialUrl, riderWhatsAppCallUrl } from '../../domain/trackingJourney';
import { mapBelowStatusBar } from '../../../../components/maps/mapBelowStatusBar';
import { CONTENT_ICONS, ContentIcon, LocationPin, deliveryIcon } from '../deliveryIcons';

type MapPoint = { latitude: number; longitude: number };

type DeliveredDeliveryProps = {
  delivery: CustomerDeliveryDetail;
  message?: string | null;
  onBack: () => void;
  children?: ReactNode;
};

const METRES_PER_LATITUDE = 111_320;
const MIN_FRAME_SPAN_METRES = 1_500;
const FRAME_LOOSEN = 0.08;
/** Matches the rider delivered map: side inset, top clearance, and the extra bounds padding. */
const SIDE_INSET = 28 + 12;
const TOP_INSET = 132 + 12;
const BOTTOM_INSET = 24 + 12;
const SHEET_FALLBACK = 240;
const SUPPORT_PHONE = '+263772569226';

export default function DeliveredDelivery({
  delivery,
  message = null,
  onBack,
  children,
}: DeliveredDeliveryProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [sheetHeight, setSheetHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const destination = mapPoint(delivery.dropoffLatitude, delivery.dropoffLongitude);
  const maxSheetHeight = Math.max(160, screenHeight - insets.top - 72);
  const sheetBodyHeight = contentHeight > 0 ? Math.min(contentHeight, maxSheetHeight) : undefined;

  return (
    <View style={styles.screen}>
      {destination ? (
        <DeliveredDestinationMap
          point={destination}
          recipient={delivery.recipientName?.trim() ?? ''}
          address={deliveryCardAddress(delivery.dropoffAddress)}
          completedAt={delivery.completedAt}
          sheetOverlap={sheetHeight > 0 ? sheetHeight : SHEET_FALLBACK}
        />
      ) : (
        <View style={[styles.mapFallback, mapBelowStatusBar(insets.top)]} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        onPress={onBack}
        style={[styles.back, { top: insets.top + spacing.md }]}
      >
        <MaterialDesignIcons name="chevron-left" size={28} color={colors.text} />
      </Pressable>
      <View
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.height);
          setSheetHeight((current) => (Math.abs(current - next) < 2 ? current : next));
        }}
        style={[
          styles.sheet,
          { maxHeight: maxSheetHeight },
          sheetBodyHeight ? { height: sheetBodyHeight } : null,
        ]}
      >
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={contentHeight > maxSheetHeight}
          scrollEnabled={contentHeight > maxSheetHeight}
          style={sheetBodyHeight ? { height: sheetBodyHeight } : { maxHeight: maxSheetHeight, flexGrow: 0 }}
          contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom }]}
          onContentSizeChange={(_width, height) => {
            const next = Math.ceil(height);
            setContentHeight((current) => (Math.abs(current - next) < 1 ? current : next));
          }}
        >
          <ErrorMessage message={message ?? null} />
          <DeliveredSummary delivery={delivery} />
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

function DeliveredSummary({ delivery }: { delivery: CustomerDeliveryDetail }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const kind = deliveryContentKind(delivery.parcelDescription);
  const content = CONTENT_ICONS[kind];
  const urgent = delivery.serviceClass === 'EXPRESS';
  const showClass = delivery.serviceClass === 'EXPRESS' || delivery.serviceClass === 'FLEXIBLE';
  const when = delivery.createdAt ? deliveryWhenLabel(delivery.createdAt) : '';
  const pickup = deliveryCardAddress(delivery.pickupAddress);
  const sender = delivery.senderName?.trim() ?? '';
  const amount = (delivery.offeredPrice?.trim() || delivery.suggestedPrice).trim();
  return (
    <View style={styles.summary}>
      <View style={styles.typeRow}>
        <ContentIcon kind={kind} />
        <Text style={styles.typeLabel}>{content.label}</Text>
        {showClass ? (
          <View style={styles.classChip}>
            <MaterialDesignIcons
              name={urgent ? 'flash-outline' : 'message-text-outline'}
              color={colors.textSecondary}
              size={12}
              style={urgent ? styles.urgentIcon : undefined}
            />
            <Text style={styles.classText}>{urgent ? 'Urgent' : 'Flexible'}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.facts}>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>Delivery</Text>
          <Text style={styles.factValue}>{shortDeliveryReference(delivery.id)}</Text>
        </View>
        {when ? (
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Requested</Text>
            <Text style={styles.factValue}>{when}</Text>
          </View>
        ) : null}
      </View>
      {pickup || sender ? <AddressStop line={pickup} name={sender} /> : null}
      <SectionDivider />
      <View style={styles.priceRow}>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>Distance</Text>
          <Text style={styles.distanceValue}>{distanceLabel(delivery.distanceMeters)}</Text>
        </View>
        <View style={styles.priceFact}>
          <Text style={styles.factLabel}>Price</Text>
          <Text style={styles.priceValue}>{amount ? moneyLabel(delivery.currency, amount) : 'Unavailable'}</Text>
        </View>
      </View>
      <SectionDivider />
      <SupportRow deliveryId={delivery.id} />
    </View>
  );
}

function SupportRow({ deliveryId }: { deliveryId: string }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reference = shortDeliveryReference(deliveryId).replace(/^#/, '');
  const message = `Hello, I have a question or complaint about delivery #${reference}.`;

  function callSupport() {
    const url = riderDialUrl(SUPPORT_PHONE);
    if (url) {
      void Linking.openURL(url);
    }
  }

  async function openWhatsApp() {
    const base = riderWhatsAppCallUrl(SUPPORT_PHONE);
    if (!base) {
      return;
    }
    const appUrl = `${base}&text=${encodeURIComponent(message)}`;
    const webUrl = `https://wa.me/${SUPPORT_PHONE.slice(1)}?text=${encodeURIComponent(message)}`;
    try {
      if (await Linking.canOpenURL(appUrl)) {
        await Linking.openURL(appUrl);
        return;
      }
    } catch {
      // WhatsApp is not available to the app.
    }
    try {
      await Linking.openURL(webUrl);
    } catch {
      // Leave the screen unchanged when neither WhatsApp nor the web link can open.
    }
  }

  return (
    <View style={styles.supportRow}>
      <Text style={styles.supportPrompt}>Questions or complaints?</Text>
      <View style={styles.supportActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Call support"
          hitSlop={8}
          onPress={callSupport}
          style={styles.contactAction}
        >
          <MaterialDesignIcons name="phone-outline" size={22} color="#111111" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="WhatsApp support"
          hitSlop={8}
          onPress={() => {
            void openWhatsApp();
          }}
          style={styles.contactAction}
        >
          <MaterialDesignIcons name="whatsapp" size={22} color="#111111" />
        </Pressable>
      </View>
    </View>
  );
}

function SectionDivider() {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <LinearGradient
      colors={['transparent', colors.border, 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.divider}
    />
  );
}

function AddressStop({ line, name }: { line: string; name?: string }) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.stop}>
      <View style={styles.pin}>
        <LocationPin />
      </View>
      <View style={styles.stopCopy}>
        {name ? <Text style={styles.stopName}>{name}</Text> : null}
        {line ? <Text style={styles.address}>{line}</Text> : null}
      </View>
    </View>
  );
}

function DeliveredDestinationMap({
  point,
  recipient,
  address,
  completedAt,
  sheetOverlap,
}: {
  point: MapPoint;
  recipient: string;
  address: string;
  completedAt: string | null;
  sheetOverlap: number;
}) {
  const { colors } = useAppearance();
  const mapStyle = useGoogleMapStyle();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const gestured = useRef(false);
  const [trackMarker, setTrackMarker] = useState(true);
  const mapHeight = Math.max(1, window.height - insets.top);
  const deliveredTime = completedAt ? deliveryWhenLabel(completedAt) : '';
  const region = deliveredCameraRegion(point, window.width, mapHeight, 0, sheetOverlap);
  const regionKey = [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]
    .map((value) => value.toFixed(5))
    .join(':');
  const regionRef = useRef(region);
  regionRef.current = region;

  useEffect(() => {
    setTrackMarker(true);
    const timer = setTimeout(() => setTrackMarker(false), 500);
    return () => clearTimeout(timer);
  }, [address, completedAt, point.latitude, point.longitude, recipient]);

  useEffect(() => {
    if (gestured.current || !mapRef.current) {
      return;
    }
    mapRef.current.animateToRegion(regionRef.current, 450);
  }, [regionKey]);

  function rememberGesture(_region: Region, details: Details) {
    if (details?.isGesture) {
      gestured.current = true;
    }
  }

  return (
    <MapBoundary fallback={<View style={[styles.mapFallback, mapBelowStatusBar(insets.top)]} />}>
      <MapView
        ref={mapRef}
        style={mapBelowStatusBar(insets.top)}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        customMapStyle={mapStyle}
        userInterfaceStyle={mapStyle ? 'dark' : 'light'}
        initialRegion={region}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        onMapReady={() => {
          if (!gestured.current) {
            mapRef.current?.animateToRegion(regionRef.current, 1);
          }
        }}
        onPanDrag={() => {
          gestured.current = true;
        }}
        onRegionChangeComplete={rememberGesture}
      >
        <Marker
          coordinate={point}
          anchor={{ x: 0.5, y: 1 }}
          tracksViewChanges={trackMarker}
          zIndex={2}
          accessibilityLabel="Delivered"
        >
          <View collapsable={false} style={styles.marker}>
            <View style={styles.deliveredShadowWrap}>
              <View style={styles.deliveredShadow} />
            <View style={styles.deliveredLabel}>
              <View style={styles.deliveredTitleRow}>
                <View style={styles.checkCircle}>
                  <MaterialDesignIcons name="check" size={12} color="#16845B" />
                </View>
                <Text style={styles.deliveredTitle}>Delivered</Text>
              </View>
              {recipient ? <Text style={styles.deliveredName}>{recipient}</Text> : null}
              {address ? <Text style={styles.deliveredPlace}>{address}</Text> : null}
              {deliveredTime ? (
                <View style={styles.deliveredTimeRow}>
                  <MaterialDesignIcons name="clock-outline" size={12} color={colors.textInverse} />
                  <Text style={styles.deliveredTime}>{deliveredTime}</Text>
                </View>
              ) : null}
            </View>
            </View>
            <MaterialDesignIcons name="map-marker" size={36} color={deliveryIcon.dropoff} />
          </View>
        </Marker>
      </MapView>
    </MapBoundary>
  );
}

function deliveredCameraRegion(
  point: MapPoint,
  width: number,
  height: number,
  statusTop: number,
  sheetOverlap: number,
): Region {
  const longitudeScale = METRES_PER_LATITUDE * Math.max(Math.cos((point.latitude * Math.PI) / 180), 0.2);
  const span = MIN_FRAME_SPAN_METRES * (1 + FRAME_LOOSEN);
  const top = statusTop + TOP_INSET;
  const bottom = Math.min(sheetOverlap + BOTTOM_INSET, Math.max(BOTTOM_INSET, height - top - 96));
  const innerHeight = Math.max(96, height - top - bottom);
  const innerWidth = Math.max(96, width - SIDE_INSET * 2);
  const latitudeDelta = (span / METRES_PER_LATITUDE) * (height / innerHeight);
  const longitudeDelta = (span / longitudeScale) * (width / innerWidth);
  const paddedCenter = top + innerHeight / 2;
  const southOfCenter = (height / 2 - paddedCenter) / height;
  return {
    latitude: point.latitude - southOfCenter * latitudeDelta,
    longitude: point.longitude,
    latitudeDelta,
    longitudeDelta,
  };
}

function mapPoint(latitude: number | null, longitude: number | null): MapPoint | null {
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function distanceLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return 'Unavailable';
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const kilometres = meters / 1000;
  const text = kilometres >= 10 ? String(Math.round(kilometres)) : kilometres.toFixed(1);
  return `${text} km`;
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

function createStyles(colors: Palette) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  mapFallback: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.canvas,
  },
  back: {
    position: 'absolute',
    left: spacing.lg,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    elevation: 12,
    shadowColor: '#17211D',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  summary: {
    gap: spacing.sm,
  },
  divider: {
    height: 1,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  classChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  urgentIcon: {
    marginRight: -3,
  },
  classText: {
    fontSize: typography.small,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  facts: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  fact: {
    flex: 1,
    gap: spacing.xs,
  },
  factLabel: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  factValue: {
    fontSize: typography.body,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  pin: {
    width: 22,
    marginTop: 1,
    alignItems: 'center',
  },
  stopCopy: {
    flex: 1,
    gap: 2,
  },
  stopName: {
    fontSize: typography.body,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
  },
  address: {
    fontSize: typography.body,
    lineHeight: 23,
    color: colors.text,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: spacing.lg,
  },
  distanceValue: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.text,
  },
  priceFact: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  priceValue: {
    fontSize: typography.heading,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.text,
  },
  supportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  supportPrompt: {
    flex: 1,
    fontSize: typography.body,
    lineHeight: 22,
    fontWeight: '500',
    color: '#287D60',
  },
  supportActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  contactAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    alignItems: 'center',
  },
  deliveredShadowWrap: {
    marginBottom: 5,
    paddingBottom: 3,
  },
  deliveredShadow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 3,
    bottom: 0,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(23, 33, 29, 0.2)',
  },
  deliveredLabel: {
    alignItems: 'flex-start',
    backgroundColor: '#16845B',
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
  },
  checkCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.textInverse,
  },
  deliveredTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deliveredTitle: {
    color: colors.textInverse,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    includeFontPadding: false,
  },
  deliveredName: {
    maxWidth: 220,
    color: colors.textInverse,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    includeFontPadding: false,
  },
  deliveredPlace: {
    maxWidth: 220,
    color: colors.textInverse,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '400',
    includeFontPadding: false,
  },
  deliveredTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deliveredTime: {
    color: colors.textInverse,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    includeFontPadding: false,
  },
});
}
