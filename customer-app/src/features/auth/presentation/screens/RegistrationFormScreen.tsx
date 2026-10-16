import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorMessage from '../../../../components/ErrorMessage';
import FormInput from '../../../../components/FormInput';
import PrimaryButton from '../../../../components/PrimaryButton';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { useRegistrationForm } from '../viewmodels/useRegistrationForm';
import { useSession } from '../viewmodels/useSession';

type RegistrationProps = NativeStackScreenProps<RootStackParamList, 'RegistrationForm'>;

export default function RegistrationFormScreen({ route }: RegistrationProps) {
  const { registrationToken, phone } = route.params;
  const { saveSession } = useSession();
  const form = useRegistrationForm(registrationToken);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Finish your account</Text>
      <Text style={styles.subtitle}>
        This number is verified and stays with this account.
      </Text>
      <Text style={styles.label}>Verified mobile number</Text>
      <Text style={styles.phone}>{phone}</Text>

      <Text style={styles.label}>Account type</Text>
      <View style={styles.kinds}>
        <KindButton
          label="Individual"
          selected={form.accountKind === 'INDIVIDUAL'}
          onPress={() => form.setAccountKind('INDIVIDUAL')}
        />
        <KindButton
          label="Business"
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
          editable={!form.isLoading}
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
          />
          <FormInput
            label="Contact person"
            value={form.contactName}
            onChangeText={form.setContactName}
            placeholder="Tendai Moyo"
            textContentType="name"
            autoComplete="off"
            editable={!form.isLoading}
          />
        </>
      )}

      <FormInput
        label="Address"
        value={form.address}
        onChangeText={form.setAddress}
        placeholder="12 Samora Machel Avenue"
        textContentType="fullStreetAddress"
        autoComplete="off"
        editable={!form.isLoading}
      />
      <ErrorMessage message={saveError ?? form.error} />
      <PrimaryButton
        label="Create account"
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
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.kind, selected && styles.kindSelected]}
    >
      <Text style={[styles.kindLabel, selected && styles.kindLabelSelected]}>{label}</Text>
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
  phone: {
    fontSize: typography.button,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.xl,
  },
  kinds: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  kind: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  kindSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
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
