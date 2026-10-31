import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import { useKeyboardLift } from '../../../../components/useKeyboardLift';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { bookingMode } from '../../../account/domain/customerAccount';
import { useCustomerAccount } from '../../../account/presentation/viewmodels/useCustomerAccount';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import type { RootStackParamList } from '../../../../navigation/types';
import { bookingNavigationDelay, CONFIRM_MS } from '../../../../navigation/screenMotion';
import { colors, radius, spacing, typography } from '../../../../theme';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { selectedPlaceBias, usePlaceBias } from '../viewmodels/usePlaceBias';
import { contactPhoneForField } from '../../domain/bookingDraft';
import { showsCurrentLocationAction } from '../../domain/pickupLocation';
import BookingProgress, { bookingStepTitle } from '../components/BookingProgress';
import BookingStepMotion from '../components/BookingStepMotion';
import BookingSummary from '../components/BookingSummary';
import ParcelFields from '../components/ParcelFields';
import PickupLocationAction from '../components/PickupLocationAction';
import StopFields from '../components/StopFields';
import { useParcelBooking, type BookingResult, type BookingStep } from '../viewmodels/useParcelBooking';
import { useReduceMotion } from '../../../../components/useMotion';

type ParcelRequestProps = NativeStackScreenProps<RootStackParamList, 'ParcelRequest'>;

export default function ParcelRequestScreen({ navigation }: ParcelRequestProps) {
  const { accessToken } = useSession();
  const { account, isLoading, error: accountError } = useCustomerAccount(accessToken);
  const mode = bookingMode(account ? account.marketplaceEnabled : null);
  const marketplace = mode === 'v2';
  const booking = useParcelBooking(accessToken, marketplace);
  const keyboard = useKeyboardLift();
  const deviceBias = usePlaceBias();
  const allowLeave = useRef(false);
  const leaving = useRef(false);
  const pickupPrefilled = useRef(false);
  const scrollOffsets = useRef<Partial<Record<BookingStep, number>>>({});
  const stepRef = useRef(booking.step);
  const [booked, setBooked] = useState(false);
  const reduceMotion = useReduceMotion();
  stepRef.current = booking.step;

  useEffect(() => {
    navigation.setOptions({ title: bookingStepTitle(booking.step) });
  }, [booking.step, navigation]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowLeave.current) {
        return;
      }
      if (leaving.current || booking.busy) {
        event.preventDefault();
        return;
      }
      if (booking.step === 'pickup') {
        return;
      }
      event.preventDefault();
      booking.goBack();
    });
    return unsubscribe;
  }, [booking, navigation]);

  useEffect(() => {
    if (!account || pickupPrefilled.current) {
      return;
    }
    pickupPrefilled.current = true;
    const name = account.kind === 'BUSINESS' ? account.contactName ?? account.name : account.name;
    booking.prefillPickup({
      contactName: name ?? '',
      contactPhone: contactPhoneForField(account.phone),
      address: account.address,
    });
  }, [account, booking]);

  useEffect(() => {
    const y = scrollOffsets.current[booking.step] ?? 0;
    const frame = requestAnimationFrame(() => {
      keyboard.scrollRef.current?.scrollTo({ y, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [booking.step, keyboard.scrollRef]);

  function openTracking(result: BookingResult) {
    allowLeave.current = true;
    navigation.replace('DeliveryTracking', { deliveryId: result.request.id });
  }

  function finish(result: BookingResult) {
    if (leaving.current) {
      return;
    }
    leaving.current = true;
    const delay = bookingNavigationDelay(true, reduceMotion);
    if (delay === 0) {
      openTracking(result);
      return;
    }
    setBooked(true);
    setTimeout(() => openTracking(result), delay);
  }

  if (mode !== 'v2') {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.content}>
          {mode === 'unknown' && isLoading ? <LoadingIndicator /> : (
            <ErrorMessage message={mode === 'unknown'
              ? (accountError ?? 'Account details are unavailable.')
              : 'Express and Flexible booking is unavailable right now.'} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        ref={keyboard.scrollRef}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: spacing.xxl + keyboard.keyboardInset },
        ]}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          const y = event.nativeEvent.contentOffset.y;
          scrollOffsets.current[stepRef.current] = y;
          keyboard.onScroll(y);
        }}
        scrollEventThrottle={16}
      >
        <BookingProgress step={booking.step} />
        <BookingStepMotion step={booking.step}>
        {booking.step === 'pickup' ? (
          <StopFields
            stop={booking.draft.pickup}
            onChange={(patch) => booking.updateStop('pickup', patch)}
            searchPlaces={(text, sessionToken) => searchPlaces(accessToken, text, deviceBias, sessionToken)}
            resolvePlace={(placeId, sessionToken) => resolvePlace(accessToken, placeId, sessionToken)}
            areaChoices={booking.areaChoices}
            showLandmark={false}
            locationAction={showsCurrentLocationAction(booking.step) ? (
              <PickupLocationAction
                stop={booking.draft.pickup}
                onApply={(patch) => booking.updateStop('pickup', patch)}
              />
            ) : null}
          />
        ) : null}
        {booking.step === 'destination' ? (
          <StopFields
            stop={booking.draft.dropoff}
            onChange={(patch) => booking.updateStop('dropoff', patch)}
            searchPlaces={(text, sessionToken) => searchPlaces(
              accessToken,
              text,
              selectedPlaceBias(booking.draft.pickup.latitude, booking.draft.pickup.longitude) ?? deviceBias,
              sessionToken,
            )}
            resolvePlace={(placeId, sessionToken) => resolvePlace(accessToken, placeId, sessionToken)}
            areaChoices={booking.areaChoices}
            showLandmark={false}
          />
        ) : null}
        {booking.step === 'parcel' ? (
          <ParcelFields draft={booking.draft} onChange={booking.updateDraft} marketplace={marketplace} />
        ) : null}
        {booking.step === 'review' || booking.step === 'confirm' ? (
          <BookingSummary
            draft={booking.draft}
            quote={booking.quote}
            quoting={booking.busy === 'quote'}
            offerText={booking.offerText}
            onOfferChange={booking.updateOffer}
            offerEditable={booking.busy === null}
            onOfferFocus={keyboard.revealFocusedField}
            marketplace={marketplace}
          />
        ) : null}
        </BookingStepMotion>
        <ErrorMessage message={booking.error} />
        <View style={styles.actions}>
          {booking.step === 'review' || booking.step === 'confirm' ? (
            <PrimaryButton
              label="Confirm"
              loading={booking.busy === 'create'}
              loadingLabel="Booking"
              disabled={Boolean(booking.busy) || booked || !booking.quote}
              onPress={() => {
                if (leaving.current) {
                  return;
                }
                void booking.confirm(finish);
              }}
            />
          ) : (
            <PrimaryButton
              label="Continue"
              trailingIcon={booking.step === 'parcel' ? 'chevron-right' : undefined}
              loading={booking.busy === 'quote' || booking.busy === 'locate'}
              loadingLabel={booking.busy === 'locate' ? 'Finding address' : 'Getting price'}
              disabled={Boolean(booking.busy)}
              onPress={() => {
                void booking.goNext();
              }}
            />
          )}
          {booking.step === 'pickup' ? null : (
            <SecondaryButton label="Back" soft onPress={booking.goBack} disabled={Boolean(booking.busy) || booked} />
          )}
        </View>
      </ScrollView>
      {booked ? <BookingConfirmed /> : null}
    </SafeAreaView>
  );
}

function BookingConfirmed() {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.86)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: CONFIRM_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: CONFIRM_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return (
    <View pointerEvents="none" style={styles.confirmed}>
      <Animated.View style={[styles.confirmedCard, { opacity, transform: [{ scale }] }]}>
        <View style={styles.confirmedMark}>
          <MaterialDesignIcons name="check" color={colors.primaryDark} size={28} />
        </View>
        <Text style={styles.confirmedText}>Delivery booked</Text>
      </Animated.View>
    </View>
  );
}

function searchPlaces(
  accessToken: string | null,
  text: string,
  bias: { latitude: number; longitude: number } | null,
  sessionToken: string,
) {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to search for an address.'));
  }
  return customerDeliveryRepository.searchPlaces(accessToken, text, bias, sessionToken);
}

function resolvePlace(accessToken: string | null, placeId: string, sessionToken: string) {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to search for an address.'));
  }
  return customerDeliveryRepository.resolvePlace(accessToken, placeId, sessionToken);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  actions: {
    gap: spacing.md,
  },
  confirmed: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  confirmedCard: {
    alignItems: 'center',
    gap: spacing.md,
  },
  confirmedMark: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  confirmedText: {
    fontSize: typography.heading,
    color: colors.primaryDark,
  },
});
