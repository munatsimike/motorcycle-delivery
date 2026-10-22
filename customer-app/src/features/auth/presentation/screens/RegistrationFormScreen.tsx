import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import FormInput from '../../../../components/FormInput';
import { useKeyboardLift } from '../../../../components/useKeyboardLift';
import PrimaryButton from '../../../../components/PrimaryButton';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { customerDeliveryRepository } from '../../../deliveries/data/CustomerDeliveryApiRepository';
import { emptyStop, type StopDraft } from '../../../deliveries/domain/bookingDraft';
import AddressField from '../../../deliveries/presentation/components/AddressField';
import { usePlaceBias } from '../../../deliveries/presentation/viewmodels/usePlaceBias';
import { useRegistrationForm } from '../viewmodels/useRegistrationForm';
import { useSession } from '../viewmodels/useSession';

type RegistrationProps = NativeStackScreenProps<RootStackParamList, 'RegistrationForm'>;

export default function RegistrationFormScreen({ route }: RegistrationProps) {
  const { registrationToken, phone, existing } = route.params;
  const { saveSession } = useSession();
  const form = useRegistrationForm(registrationToken, existing);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addressStop, setAddressStop] = useState<StopDraft>(() => {
    const stop = emptyStop();
    return existing?.address ? { ...stop, address: existing.address } : stop;
  });
  const placeBias = usePlaceBias();
  const keyboard = useKeyboardLift();

  async function handleSubmit() {
    setSaveError(null);
    const session = await form.submit();
    if (!session) {
      return;
    }
    try {
      await saveSession(session);
    } catch {
      setSaveError('The session could not be saved on this phone.');
    }
  }

  return (
    <ScrollView
      ref={keyboard.scrollRef}
      style={styles.container}
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
      <Text style={styles.title}>{form.existing ? 'Confirm your account' : 'Finish your account'}</Text>
      <Text style={styles.subtitle}>
        {form.existing
          ? 'Your saved details stay as they are. Add only what this account still needs.'
          : 'This number is verified and stays with this account.'}
      </Text>
      <View style={styles.phoneRow}>
        <View style={styles.phoneIcon}>
          <MaterialDesignIcons name="phone" size={20} color="#3B6FE8" />
        </View>
        <View style={styles.phoneCopy}>
          <Text style={styles.phoneLabel}>Verified mobile number</Text>
          <View style={styles.phoneValue}>
            {phone.startsWith('+263') ? (
              <Image
                source={require('../../../../../assets/zimbabwe-flag.png')}
                style={styles.flag}
                resizeMode="cover"
              />
            ) : null}
            <Text style={styles.phone}>{phone}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.label}>Account type</Text>
      <View style={styles.kinds}>
        <KindButton
          label="Individual"
          icon="account"
          selected={form.accountKind === 'INDIVIDUAL'}
          onPress={() => form.setAccountKind('INDIVIDUAL')}
        />
        <KindButton
          label="Business"
          icon="office-building"
          selected={form.accountKind === 'BUSINESS'}
          onPress={() => form.setAccountKind('BUSINESS')}
        />
      </View>

      {form.accountKind === 'INDIVIDUAL' ? (
        <FormInput
          label="Full name"
          value={form.fullName}
          onChangeText={form.setFullName}
          placeholder="Tendai Moyo"
          textContentType="name"
          autoComplete="off"
          editable={!form.isLoading && !form.nameLocked}
          onFocus={keyboard.revealFocusedField}
        />
      ) : (
        <>
          <FormInput
            label="Business name"
            value={form.businessName}
            onChangeText={form.setBusinessName}
            placeholder="Moyo Deliveries"
            autoComplete="off"
            editable={!form.isLoading}
            onFocus={keyboard.revealFocusedField}
          />
          <FormInput
            label="Contact person"
            value={form.contactName}
            onChangeText={form.setContactName}
            placeholder="Tendai Moyo"
            textContentType="name"
            autoComplete="off"
            editable={!form.isLoading && !form.nameLocked}
            onFocus={keyboard.revealFocusedField}
          />
        </>
      )}

      <AddressField
        stop={addressStop}
        editable={!form.isLoading && !form.addressLocked}
        onFocus={keyboard.revealFocusedField}
        searchPlaces={(text, sessionToken) => customerDeliveryRepository.searchRegistrationPlaces(registrationToken, text, placeBias, sessionToken)}
        resolvePlace={(placeId, sessionToken) => customerDeliveryRepository.resolveRegistrationPlace(registrationToken, placeId, sessionToken)}
        onChange={(patch) => {
          setAddressStop((current) => ({ ...current, ...patch }));
          if (patch.address !== undefined) {
            form.setAddress(patch.address);
          }
        }}
      />
      <ErrorMessage message={saveError ?? form.error} />
      <PrimaryButton
        label={form.existing ? 'Confirm and continue' : 'Create account'}
        trailingIcon="chevron-right"
        onPress={() => {
          void handleSubmit();
        }}
        loading={form.isLoading}
      />
    </ScrollView>
  );
}

function KindButton({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof MaterialDesignIcons>['name'];
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.kindPress, pressed && styles.pressed]}
    >
      <View style={[styles.kind, selected && styles.kindSelected]}>
        {selected ? (
          <View style={styles.check}>
            <MaterialDesignIcons name="check" size={12} color={colors.textInverse} />
          </View>
        ) : null}
        <View style={[styles.kindIcon, selected && styles.kindIconSelected]}>
          <MaterialDesignIcons name={icon} size={22} color={selected ? colors.primary : colors.text} />
        </View>
        <Text style={[styles.kindLabel, selected && styles.kindLabelSelected]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#F8FAF9',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
  },
  phoneIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F1FF',
  },
  phoneCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  phoneValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flag: {
    width: 28,
    height: 22,
    borderRadius: 2,
  },
  phoneLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  phone: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  kinds: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  kindPress: {
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },
  kind: {
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  kindSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  check: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  kindIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  kindIconSelected: {
    backgroundColor: colors.background,
  },
  kindLabel: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  kindLabelSelected: {
    color: colors.primaryDark,
  },
});
