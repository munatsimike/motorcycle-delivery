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
import { zimbabweMobileE164 } from '../../domain/bookingDraft';
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
  const allowLeave = useRef(false);

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
    if (!account) {
      return;
    }
    const phone = nationalPhone(account.phone);
    const name = account.kind === 'BUSINESS' ? account.contactName ?? account.name : account.name;
    if (!name || !phone) {
      return;
    }
    booking.prefillPickupContact(name, phone);
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
          <StopFields stop={booking.draft.pickup} onChange={(patch) => booking.updateStop('pickup', patch)} />
        ) : null}
        {booking.step === 'destination' ? (
          <StopFields stop={booking.draft.dropoff} onChange={(patch) => booking.updateStop('dropoff', patch)} />
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
          {booking.step === 'pickup' ? null : (
            <SecondaryButton label="Back" onPress={booking.goBack} disabled={Boolean(booking.busy)} />
          )}
          {booking.step === 'confirm' ? (
            <PrimaryButton
              label="Confirm delivery"
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
              loading={booking.busy === 'quote'}
              loadingLabel="Getting price"
              disabled={Boolean(booking.busy)}
              onPress={() => {
                void booking.goNext();
              }}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function nationalPhone(phone: string): string | null {
  const e164 = zimbabweMobileE164(phone);
  if (!e164) {
    return null;
  }
  return e164.slice(4);
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
