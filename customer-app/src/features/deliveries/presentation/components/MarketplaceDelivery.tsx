import { useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { colors, radius, spacing, typography } from '../../../../theme';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { formatDeadline } from '../../domain/bookingDraft';
import { acceptanceKeys, createAcceptanceKey } from '../../data/acceptanceKeyStore';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import {
  acceptancePrompt,
  acceptableBids,
  bidCanAccept,
  bidsAfterFailure,
  committedDelivery,
  createAcceptanceGate,
  waitsForRiderConfirmation,
  type CustomerBid,
} from '../../domain/customerBids';
import type { CustomerDeliveryDetail } from '../../domain/customerDeliveryDetail';
import { deliveryStatusLabel } from '../../domain/deliveryStatus';
import { locationPresentation, shouldPollBids, visibleBidError } from '../../domain/marketplaceTracking';
import { riderMapFrame } from '../../domain/riderMapTile';
import { TRACKING_POLL_MS } from '../../domain/deliveryTracking';
import { acceptCustomerBid } from '../../domain/usecases/acceptCustomerBid';
import RiderLocationMap from './RiderLocationMap';

type MarketplaceDeliveryProps = {
  delivery: CustomerDeliveryDetail;
  accessToken: string | null;
  loadError: string | null;
  onRefreshDelivery: () => void;
};

export default function MarketplaceDelivery({
  delivery,
  accessToken,
  loadError,
  onRefreshDelivery,
}: MarketplaceDeliveryProps) {
  const focused = useIsFocused();
  const [bids, setBids] = useState<CustomerBid[]>([]);
  const [bidError, setBidError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [loadedDeliveryId, setLoadedDeliveryId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [override, setOverride] = useState<CustomerDeliveryDetail | null>(null);
  const request = useRef(0);
  const gate = useRef(createAcceptanceGate());
  const shown = override && override.id === delivery.id && delivery.status === 'CREATED' ? override : delivery;
  const location = locationPresentation(shown.id, shown);
  const deadline = shown.deliverBy ? formatDeadline(shown.deliverBy) : null;
  const openBids = acceptableBids(bids.filter((bid) => bid.deliveryId === shown.id));

  if (loadedDeliveryId !== shown.id) {
    setLoadedDeliveryId(shown.id);
    setBids([]);
    setBidError(null);
    setAcceptError(null);
    setOverride(null);
  }

  async function loadBids(deliveryId = shown.id) {
    if (!accessToken) {
      setBidError('Sign in again.');
      return;
    }
    const current = request.current + 1;
    request.current = current;
    try {
      const next = await customerDeliveryRepository.listBids(accessToken, deliveryId);
      if (request.current !== current) {
        return;
      }
      setBids(next.filter((bid) => bid.deliveryId === deliveryId));
      setBidError(null);
    } catch (caught: unknown) {
      if (request.current !== current) {
        return;
      }
      setBids((currentBids) => bidsAfterFailure(currentBids));
      setBidError(errorMessage(caught, 'Bids are unavailable.'));
    }
  }

  useEffect(() => {
    if (!focused) {
      return;
    }
    void loadBids(shown.id);
  }, [accessToken, shown.id, focused]);

  useEffect(() => {
    if (!focused || !shouldPollBids(shown)) {
      return;
    }
    const timer = setInterval(() => {
      void loadBids(shown.id);
    }, TRACKING_POLL_MS);
    return () => clearInterval(timer);
  }, [focused, shown.id, shown.status, shown.serviceClass]);

  function refresh() {
    setRefreshing(true);
    onRefreshDelivery();
    void loadBids(shown.id).finally(() => setRefreshing(false));
  }

  function askAccept(bid: CustomerBid) {
    if (!bidCanAccept(bid) || shown.status !== 'CREATED' || acceptingId || waitsForRiderConfirmation()) {
      return;
    }
    Alert.alert('Accept this bid?', acceptancePrompt(bid), [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Accept bid',
        onPress: () => {
          void accept(bid);
        },
      },
    ]);
  }

  async function accept(bid: CustomerBid) {
    if (!gate.current.begin()) {
      return;
    }
    setAcceptingId(bid.id);
    setAcceptError(null);
    try {
      const accepted = await acceptCustomerBid(
        customerDeliveryRepository,
        acceptanceKeys,
        accessToken,
        shown.id,
        bid.id,
        createAcceptanceKey,
      );
      setOverride(committedDelivery(shown, accepted));
      setBids([]);
      onRefreshDelivery();
      void loadBids(shown.id);
    } catch (caught: unknown) {
      setAcceptError(errorMessage(caught, 'This bid could not be accepted.'));
      onRefreshDelivery();
      void loadBids(shown.id);
    } finally {
      gate.current.end();
      setAcceptingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />
        )}
      >
        <Text style={styles.kicker}>{shown.serviceClass === 'EXPRESS' ? 'Express' : 'Flexible'}</Text>
        <Text style={styles.title}>{deliveryStatusLabel(shown.status)}</Text>
        {shown.status === 'CREATED' ? (
          <Text style={styles.body}>Riders can bid on this request. Accepting a bid assigns that rider immediately.</Text>
        ) : (
          <Text style={styles.body}>This is the latest status from your delivery.</Text>
        )}
        <View style={styles.card}>
          {deadline ? <Fact label="Deliver by" value={deadline} /> : null}
          {shown.offeredPrice ? (
            <>
              <Fact label="Agreed price" value={`${shown.currency} ${shown.offeredPrice}`} />
              <Fact label="Suggested price" value={`${shown.currency} ${shown.suggestedPrice}`} />
            </>
          ) : (
            <>
              <Fact label="Suggested price" value={`${shown.currency} ${shown.suggestedPrice}`} />
              <Text style={styles.note}>Riders bid their own price. This suggestion is not the agreed price.</Text>
            </>
          )}
          <Fact label="Parcel" value={shown.parcelDescription} />
          <Fact label="Pickup" value={shown.pickupAddress} />
          <Fact label="Destination" value={shown.dropoffAddress} />
        </View>
        {location.kind === 'waiting' ? (
          <Text style={styles.waiting}>Waiting for the rider's location.</Text>
        ) : null}
        {location.kind === 'rider' && riderMapFrame(focused, location) ? (
          <RiderLocationMap
            active={focused}
            deliveryId={location.deliveryId}
            latitude={location.latitude}
            longitude={location.longitude}
          />
        ) : null}
        {shown.status === 'CREATED' ? (
          <View style={styles.bids}>
            <Text style={styles.section}>Bids</Text>
            {openBids.length === 0 && !bidError ? (
              <Text style={styles.waiting}>Waiting for bids.</Text>
            ) : null}
            {openBids.map((bid) => (
              <View key={bid.id} style={styles.bid}>
                <Text style={styles.rider}>{bid.riderName}</Text>
                <Text style={styles.amount}>{bid.currency} {bid.amount}</Text>
                <Text style={styles.bidStatus}>Open</Text>
                <PrimaryButton
                  label="Accept bid"
                  loading={acceptingId === bid.id}
                  disabled={acceptingId !== null}
                  onPress={() => askAccept(bid)}
                />
              </View>
            ))}
          </View>
        ) : null}
        <ErrorMessage message={acceptError ?? visibleBidError(shown.status, bidError) ?? loadError} />
        <SecondaryButton label="Refresh" onPress={refresh} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  kicker: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '800',
    color: colors.text,
  },
  body: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  fact: {
    gap: spacing.xs,
  },
  factLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  factValue: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  note: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  waiting: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  bids: {
    gap: spacing.sm,
  },
  section: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.text,
  },
  bid: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  rider: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  amount: {
    fontSize: typography.heading,
    fontWeight: '800',
    color: colors.text,
  },
  bidStatus: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primaryDark,
  },
});
