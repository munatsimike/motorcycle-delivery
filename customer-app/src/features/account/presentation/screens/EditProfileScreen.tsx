import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import FormInput from '../../../../components/FormInput';
import ZimbabwePhoneField from '../../../../components/ZimbabwePhoneField';
import { useKeyboardLift } from '../../../../components/useKeyboardLift';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, spacing, typography } from '../../../../theme';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import { emptyStop, type StopDraft } from '../../../deliveries/domain/bookingDraft';
import AddressField from '../../../deliveries/presentation/components/AddressField';
import { usePlaceBias } from '../../../deliveries/presentation/viewmodels/usePlaceBias';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import { useEditProfile } from '../viewmodels/useEditProfile';

type EditProfileProps = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

export default function EditProfileScreen({ route, navigation }: EditProfileProps) {
  const { accessToken } = useSession();
  const form = useEditProfile(accessToken, route.params.account);
  const placeBias = usePlaceBias();
  const keyboard = useKeyboardLift();
  const [addressStop, setAddressStop] = useState<StopDraft>(() => ({
    ...emptyStop(),
    address: route.params.account.address,
    latitude: route.params.account.address ? '0' : '',
    longitude: route.params.account.address ? '0' : '',
    precision: 'exact',
  }));

  async function handleSave() {
    const saved = await form.save();
    if (!saved) {
      return;
    }
    Alert.alert('Profile updated', 'Your changes have been saved.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  }

  return (
    <ScrollView
      ref={keyboard.scrollRef}
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: spacing.xxl + keyboard.keyboardInset },
      ]}
      keyboardShouldPersistTaps="handled"
      onScroll={(event) => {
        keyboard.onScroll(event.nativeEvent.contentOffset.y);
      }}
      scrollEventThrottle={16}
    >
      <Text style={styles.section}>Personal information</Text>
      <FormInput
        label="Full name"
        value={form.fullName}
        onChangeText={form.setFullName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={200}
        error={form.fieldErrors.fullName}
        onFocus={keyboard.revealFocusedField}
      />
      <AddressField
        stop={addressStop}
        error={form.fieldErrors.address}
        showMatchNote={false}
        searchPlaces={(text, sessionToken) => searchPlaces(accessToken, text, placeBias, sessionToken)}
        resolvePlace={(placeId, sessionToken) => resolvePlace(accessToken, placeId, sessionToken)}
        onFocus={keyboard.revealFocusedField}
        onChange={(patch) => {
          setAddressStop((current) => ({ ...current, ...patch }));
          if (patch.address !== undefined) {
            form.setAddress(patch.address);
          }
        }}
      />
      <ZimbabwePhoneField
        label="WhatsApp number"
        value={form.phone.startsWith('+263') ? form.phone.slice(4) : form.phone.startsWith('+31') ? form.phone.slice(3) : form.phone}
        onChangeText={() => undefined}
        editable={false}
        countryCode={form.phone.startsWith('+31') ? '+31' : '+263'}
      />
      <Text style={styles.note}>Your WhatsApp number is used to sign in and cannot be changed here.</Text>
      <ErrorMessage message={form.error} />
      <View style={styles.actions}>
        <PrimaryButton
          label="Save Changes"
          loading={form.isSaving}
          loadingLabel="Saving"
          disabled={!form.canSave}
          onPress={() => {
            void handleSave();
          }}
        />
        <SecondaryButton
          label="Cancel"
          soft
          disabled={form.isSaving}
          onPress={() => navigation.goBack()}
        />
      </View>
    </ScrollView>
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
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  section: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  note: {
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing.md,
  },
});
