import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import FormInput from '../../../../components/FormInput';
import PrimaryButton from '../../../../components/PrimaryButton';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, spacing, typography } from '../../../../theme';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import { emptyStop, type StopDraft } from '../../../deliveries/domain/bookingDraft';
import AddressField from '../../../deliveries/presentation/components/AddressField';
import { clearRegistrationProof, clearRegistrationRecovery, rememberRegistrationDraft } from '../../data/registrationRecoveryStore';
import { createSingleFlight } from '../../domain/registrationRecovery';
import { useSession } from '../viewmodels/useSession';
import { useCompleteRegistration } from '../viewmodels/useCompleteRegistration';

type CompleteRegistrationProps = NativeStackScreenProps<RootStackParamList, 'CompleteRegistration'>;

export default function CompleteRegistrationScreen({ route, navigation }: CompleteRegistrationProps) {
  const { registrationToken, fullName: initialName, address: initialAddress } = route.params;
  const [fullName, setFullName] = useState(initialName ?? '');
  const [addressStop, setAddressStop] = useState<StopDraft>({ ...emptyStop(), address: initialAddress ?? '' });
  const { holdSession } = useSession();
  const { isLoading, error, complete } = useCompleteRegistration(registrationToken);
  const submitLock = useRef(createSingleFlight());
  const finished = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (finished.current) {
      return;
    }
    void rememberRegistrationDraft({ fullName, address: addressStop.address });
  }, [addressStop.address, fullName]);

  async function handleSubmit() {
    if (!submitLock.current.enter()) {
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await complete(fullName, addressStop.address);
      if (outcome.status === 'busy' || outcome.status === 'interrupted') {
        return;
      }
      if (outcome.status === 'rejected') {
        finished.current = true;
        await clearRegistrationProof();
        navigation.reset({
          index: 1,
          routes: [
            { name: 'Welcome' },
            { name: 'SignUp', params: { notice: 'Verify your number again to finish creating the account.' } },
          ],
        });
        return;
      }
      const stored = await holdSession(outcome.session);
      finished.current = true;
      if (stored === 'stored') {
        await clearRegistrationRecovery();
      }
    } finally {
      submitLock.current.leave();
      if (!finished.current) {
        setSubmitting(false);
      }
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Your details</Text>
      <Text style={styles.subtitle}>Your number is verified. Add the details for this customer account.</Text>
      <FormInput label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" editable={!isLoading} />
      <AddressField
        stop={addressStop}
        editable={!isLoading}
        showMatchNote={false}
        searchPlaces={(text, sessionToken) => customerDeliveryRepository.searchOpenPlaces(text, sessionToken)}
        resolvePlace={(placeId, sessionToken) => customerDeliveryRepository.resolveOpenPlace(placeId, sessionToken)}
        onChange={(patch) => {
          setAddressStop((current) => ({ ...current, ...patch }));
        }}
      />
      <ErrorMessage message={error} />
      <PrimaryButton
        label="Create account"
        trailingIcon="chevron-right"
        loading={isLoading || submitting}
        disabled={submitting}
        onPress={() => {
          void handleSubmit();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
});
