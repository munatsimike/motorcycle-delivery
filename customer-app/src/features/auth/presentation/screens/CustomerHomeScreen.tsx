import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useState, useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../../../../components/PrimaryButton';
import RidersMap from '../../../../components/maps/RidersMap';
import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import type { Palette } from '../../../../theme';
import { radius, spacing, typography, useAppearance } from '../../../../theme';
import { nearbyHomeCountLabel } from '../../../riders/domain/nearbyCard';
import { useNearbyRiders } from '../../../riders/presentation/viewmodels/useNearbyRiders';
import { useSession } from '../viewmodels/useSession';

type HomeNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export default function CustomerHomeScreen() {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<HomeNavigation>();
  const { accessToken } = useSession();
  const nearby = useNearbyRiders(accessToken);
  const [sheetHeight, setSheetHeight] = useState(0);
  const visibleRiders = nearby.points.length;
  const nearbyLabel = nearby.state.status === 'ready'
    ? nearbyHomeCountLabel({ status: 'ready', count: visibleRiders, points: [] })
    : nearbyHomeCountLabel(nearby.state);
  const actionable = nearby.state.status !== 'loading' && nearby.state.status !== 'ready';

  const retryNearby = () => {
    if (nearby.state.status === 'services-off') { void nearby.turnOnLocation(); return; }
    if (nearby.state.status === 'permission-denied') { void nearby.allowLocation(); return; }
    if (actionable) void nearby.tryAgain();
  };

  return (
    <View style={styles.screen}>
      {/* Reusable native map showing short-lived approximate nearby-rider positions. */}
      <RidersMap
        customerLocation={nearby.point}
        showCustomerMarker={false}
        bottomPadding={sheetHeight}
        neighborhoodView
        stableNeighborhood
        riders={nearby.points.map((point) => ({
          id: point.id,
          latitude: point.latitude,
          longitude: point.longitude,
        }))}
      />
      <View style={styles.bottomArea} onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <View style={styles.actionsCard}>
          {/* Top-only outline: short curved corners and a straight top, without full-height side borders. */}
          <View pointerEvents="none" style={styles.topOutline}>
            <View style={styles.topOutlineLeftCorner} />
            <View style={styles.topOutlineLine} />
            <View style={styles.topOutlineRightCorner} />
          </View>
          <View style={styles.deliveryIntro}>
            <View style={styles.deliveryCopy}>
              <Text style={styles.deliveryTitle}>Nearby riders</Text>
              {nearby.state.status === 'loading' ? (
                <View style={styles.statusRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.statusText}>Checking nearby riders</Text>
                </View>
              ) : (
                <Pressable disabled={!actionable} onPress={retryNearby} accessibilityRole={actionable ? 'button' : undefined} accessibilityLabel={nearbyLabel} style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: nearby.state.status === 'ready' && visibleRiders > 0 ? '#23A35D' : '#C9A76A' }]} />
                  <Text style={styles.statusText}>{nearbyLabel}</Text>
                </Pressable>
              )}
              <Text style={styles.helperText}>Find a motorcycle courier for your parcel</Text>
            </View>
            <Image source={require('../../../../../assets/rider-cutout.png')} style={styles.riderImage} resizeMode="contain" accessibilityIgnoresInvertColors />
          </View>
          <PrimaryButton label="Send a Parcel" icon="send-outline" iconRotation={-45} onPress={() => navigation.navigate('ParcelRequest')} />
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  bottomArea: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  actionsCard: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: 18, gap: 7, elevation: 6, shadowColor: '#153D28', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: -3 } },
  topOutline: { position: 'absolute', top: 0, left: 0, right: 0, height: radius.xl, flexDirection: 'row' },
  topOutlineLeftCorner: { width: radius.xl, height: radius.xl, borderTopWidth: 3, borderLeftWidth: 3, borderColor: '#BCEBD3', borderTopLeftRadius: radius.xl },
  topOutlineLine: { flex: 1, height: 3, backgroundColor: '#BCEBD3' },
  topOutlineRightCorner: { width: radius.xl, height: radius.xl, borderTopWidth: 3, borderRightWidth: 3, borderColor: '#BCEBD3', borderTopRightRadius: radius.xl },
  deliveryIntro: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deliveryCopy: { flex: 1, justifyContent: 'center', gap: spacing.xs },
  deliveryTitle: { fontSize: 19, lineHeight: 24, fontWeight: '700', color: colors.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: typography.caption, color: colors.primaryDark, fontWeight: '600' },
  helperText: { fontSize: 11, color: colors.textSecondary, lineHeight: 15, marginTop: 3 },
  riderImage: { width: 100, height: 91 },
});
}
