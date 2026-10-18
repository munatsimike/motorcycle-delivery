import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { useCustomerAccount } from '../../../account/presentation/viewmodels/useCustomerAccount';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, spacing } from '../../../../theme';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { selectedPlaceBias, usePlaceBias } from '../viewmodels/usePlaceBias';
import { contactPhoneForField } from '../../domain/bookingDraft';
import BookingProgress, { bookingStepTitle } from '../components/BookingProgress';
import BookingSummary from '../components/BookingSummary';
import ParcelFields from '../components/ParcelFields';
import StopFields from '../components/StopFields';
import { useParcelBooking } from '../viewmodels/useParcelBooking';

type ParcelRequestProps = NativeStackScreenProps<RootStackParamList, 'ParcelRequest'>;

export default function ParcelRequestScreen({ navigation }: ParcelRequestProps) {
  const { accessToken } = useSession();
  const { account } = useCustomerAccount(accessToken);
  const booking = useParcelBooking(accessToken);
  const deviceBias = usePlaceBias();
  const allowLeave = useRef(false);
  const pickupPrefilled = useRef(false);

  useEffect(() => {
    navigation.setOptions({ title: bookingStepTitle(booking.step) });
  }, [booking.step, navigation]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowLeave.current) {
        return;
      }
      if (booking.busy) {
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

  function finish(deliveryId: string) {
    allowLeave.current = true;
    navigation.replace('DeliveryTracking', { deliveryId });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <BookingProgress step={booking.step} />
        {booking.step === 'pickup' ? (
          <StopFields
            stop={booking.draft.pickup}
            onChange={(patch) => booking.updateStop('pickup', patch)}
            searchPlaces={(text) => searchPlaces(accessToken, text, deviceBias)}
            areaChoices={booking.areaChoices}
            showLandmark={false}
          />
        ) : null}
        {booking.step === 'destination' ? (
          <StopFields
            stop={booking.draft.dropoff}
            onChange={(patch) => booking.updateStop('dropoff', patch)}
            searchPlaces={(text) => searchPlaces(
              accessToken,
              text,
              selectedPlaceBias(booking.draft.pickup.latitude, booking.draft.pickup.longitude) ?? deviceBias,
            )}
            areaChoices={booking.areaChoices}
            showLandmark={false}
            showInstructions={false}
          />
        ) : null}
        {booking.step === 'parcel' ? (
          <ParcelFields draft={booking.draft} onChange={booking.updateDraft} />
        ) : null}
        {booking.step === 'review' || booking.step === 'confirm' ? (
          <BookingSummary
            draft={booking.draft}
            quote={booking.quote}
            quoting={booking.busy === 'quote'}
          />
        ) : null}
        <ErrorMessage message={booking.error} />
        <View style={styles.actions}>
          {booking.step === 'review' || booking.step === 'confirm' ? (
            <PrimaryButton
              label="Confirm"
              loading={booking.busy === 'create'}
              loadingLabel="Booking"
              disabled={Boolean(booking.busy) || !booking.quote}
              onPress={() => {
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
            <SecondaryButton label="Back" soft onPress={booking.goBack} disabled={Boolean(booking.busy)} />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function searchPlaces(
  accessToken: string | null,
  text: string,
  bias: { latitude: number; longitude: number } | null,
) {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to search for an address.'));
  }
  return customerDeliveryRepository.searchPlaces(accessToken, text, bias);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  actions: {
    gap: spacing.md,
  },
});
