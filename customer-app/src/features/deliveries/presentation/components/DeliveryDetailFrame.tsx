import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bottomContentInset, colors, contentAboveSafeArea, radius, spacing } from '../../../../theme';
import { TRACKING_MAP_HEIGHT } from '../../domain/trackingCamera';
import { mapBelowStatusBar } from '../../../../components/maps/mapBelowStatusBar';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';

type DeliveryDetailFrameProps = {
  onBack: () => void;
  header?: ReactNode;
  overlap?: number;
  refreshControl?: ScrollViewProps['refreshControl'];
  children: ReactNode;
  autoGrowOffers?: boolean;
  topOutline?: boolean;
  hugSheet?: boolean;
  onSheetHeight?: (height: number) => void;
};

export default function DeliveryDetailFrame({
  onBack,
  header,
  overlap = 100,
  refreshControl,
  children,
  autoGrowOffers = false,
  topOutline = false,
  hugSheet = false,
  onSheetHeight,
}: DeliveryDetailFrameProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [offersContentHeight, setOffersContentHeight] = useState(0);
  const [trackedSheetHeight, setTrackedSheetHeight] = useState(0);
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);
  useEffect(() => { setManuallyCollapsed(false); }, [autoGrowOffers]);
  const maxOffersHeight = Math.round(screenHeight * 0.70);
  const collapsedHeight = Math.min(148, maxOffersHeight);
  const desiredOffersHeight = Math.min(
    maxOffersHeight,
    Math.max(collapsedHeight, OFFERS_HANDLE_HEIGHT + offersContentHeight + insets.bottom),
  );
  const offersHeight = manuallyCollapsed ? collapsedHeight : desiredOffersHeight;
  useEffect(() => {
    if (autoGrowOffers) onSheetHeight?.(offersHeight);
  }, [autoGrowOffers, offersHeight, onSheetHeight]);
  const headerHeight = insets.top + 200;
  const trackedMapHeight = Math.max(240, screenHeight - (trackedSheetHeight > 0 ? trackedSheetHeight : 320) + overlap);

  const back = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      onPress={onBack}
      style={[styles.back, { top: insets.top + spacing.md }]}
    >
      <MaterialDesignIcons name="chevron-left" size={28} color={colors.text} />
    </Pressable>
  );

  if (autoGrowOffers) {
    return (
      <View style={styles.screen}>
        <View style={[styles.offersMapBackground, { height: screenHeight }]}>
          {header ?? <MapView
        pointerEvents="none"
        provider={PROVIDER_GOOGLE}
        style={mapBelowStatusBar(insets.top)}
        initialRegion={{ latitude: -17.8292, longitude: 31.0522, latitudeDelta: 0.07, longitudeDelta: 0.07 }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      />}
          {back}
        </View>
        <View style={[styles.offersFloatingSheet, { height: offersHeight, paddingBottom: insets.bottom }]}>
          {topOutline ? (
            <View pointerEvents="none" style={styles.topOutline}>
              <View style={styles.topOutlineLeftCorner} />
              <View style={styles.topOutlineLine} />
              <View style={styles.topOutlineRightCorner} />
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={manuallyCollapsed ? 'Expand rider offers' : 'Collapse rider offers'}
            onPress={() => setManuallyCollapsed((value) => !value)}
            style={styles.offersHandleTouch}
          >
            <View style={styles.offersHandle} />
          </Pressable>
          <ScrollView
            style={styles.offersInnerScroll}
            contentContainerStyle={styles.offersInnerContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={offersContentHeight > maxOffersHeight}
            scrollEnabled={!manuallyCollapsed}
            refreshControl={refreshControl}
            onContentSizeChange={(_width, height) => setOffersContentHeight(height)}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    );
  }

  if (hugSheet && header) {
    return (
      <View style={styles.screen}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          refreshControl={refreshControl}
        >
          <View collapsable={false} style={[styles.liveMap, { height: trackedMapHeight }]}>
            {header}
            {back}
          </View>
          <View
            onLayout={(event) => {
              const next = Math.round(event.nativeEvent.layout.height);
              setTrackedSheetHeight((current) => (Math.abs(current - next) < 2 ? current : next));
            }}
            style={[styles.sheet, styles.hugSheet, { marginTop: -overlap, paddingBottom: bottomContentInset(insets.bottom) }]}
          >
            {topOutline ? (
              <View pointerEvents="none" style={styles.topOutline}>
                <View style={styles.topOutlineLeftCorner} />
                <View style={styles.topOutlineLine} />
                <View style={styles.topOutlineRightCorner} />
              </View>
            ) : null}
            {children}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        refreshControl={refreshControl}
      >
        <View
          collapsable={false}
          style={header ? [styles.liveMap, { height: TRACKING_MAP_HEIGHT }] : [styles.mapHeader, { height: headerHeight }]}
        >
          {header ?? <MapView
        pointerEvents="none"
        provider={PROVIDER_GOOGLE}
        style={mapBelowStatusBar(insets.top)}
        initialRegion={{ latitude: -17.8292, longitude: 31.0522, latitudeDelta: 0.07, longitudeDelta: 0.07 }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      />}
          {header ? null : (
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(201,239,217,0.72)', 'rgba(229,247,238,0.35)', 'rgba(247,252,249,0.55)']}
              locations={[0, 0.62, 1]}
              style={[styles.wash, { top: insets.top }]}
            />
          )}
          {back}
        </View>
        <View style={[styles.sheet, { marginTop: -overlap, paddingBottom: bottomContentInset(insets.bottom) }]}>
          {topOutline ? (
            <View pointerEvents="none" style={styles.topOutline}>
              <View style={styles.topOutlineLeftCorner} />
              <View style={styles.topOutlineLine} />
              <View style={styles.topOutlineRightCorner} />
            </View>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

const OFFERS_HANDLE_HEIGHT = 28;

const styles = StyleSheet.create({
  topOutline: { position: 'absolute', top: 0, left: 0, right: 0, height: radius.xl, flexDirection: 'row', zIndex: 3 },
  topOutlineLeftCorner: { width: radius.xl, height: radius.xl, borderTopWidth: 3, borderLeftWidth: 3, borderColor: '#BCEBD3', borderTopLeftRadius: radius.xl },
  topOutlineLine: { flex: 1, height: 3, backgroundColor: '#BCEBD3' },
  topOutlineRightCorner: { width: radius.xl, height: radius.xl, borderTopWidth: 3, borderRightWidth: 3, borderColor: '#BCEBD3', borderTopRightRadius: radius.xl },
  offersMapBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  offersFloatingSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.listBackground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  offersHandleTouch: {
    height: OFFERS_HANDLE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offersHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  offersInnerScroll: { flex: 1 },
  offersInnerContent: { paddingTop: spacing.sm, paddingBottom: contentAboveSafeArea },
  screen: {
    flex: 1,
    backgroundColor: '#F7FCF9',
  },
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    flexGrow: 1,
  },
  liveMap: {
    width: '100%',
  },
  mapHeader: {
    width: '100%',
  },
  wash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  back: {
    position: 'absolute',
    left: spacing.lg,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  hugSheet: {
    flexGrow: 0,
  },
  sheet: {
    flexGrow: 1,
    paddingTop: spacing.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
});
