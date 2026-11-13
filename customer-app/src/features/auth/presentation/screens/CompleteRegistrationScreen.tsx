import { useEffect, useRef, useState, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import ErrorMessage from '../../../../components/ErrorMessage';
import FormInput from '../../../../components/FormInput';
import PrimaryButton from '../../../../components/PrimaryButton';
import { KeyboardFieldFocusContext, useKeyboardLift } from '../../../../components/useKeyboardLift';
import type { RootStackParamList } from '../../../../navigation/types';
import type { Palette } from '../../../../theme';
import { radius, spacing, typography, useAppearance } from '../../../../theme';
import { clearRegistrationProof, clearRegistrationRecovery, rememberRegistrationDraft } from '../../data/registrationRecoveryStore';
import { registrationNameFieldError } from '../../domain/registrationName';
import { verifiedRegistrationPhone } from '../../domain/registrationRecovery';
import { createSingleFlight } from '../../domain/registrationRecovery';
import { useSession } from '../viewmodels/useSession';
import { useCompleteRegistration } from '../viewmodels/useCompleteRegistration';

type CompleteRegistrationProps = NativeStackScreenProps<RootStackParamList, 'CompleteRegistration'>;

export default function CompleteRegistrationScreen({ route, navigation }: CompleteRegistrationProps) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { registrationToken, fullName: initialName } = route.params;
  const verifiedPhone = verifiedRegistrationPhone(registrationToken);
  const [fullName, setFullName] = useState(initialName ?? '');
  const { holdSession } = useSession();
  const { isLoading, error, complete } = useCompleteRegistration(registrationToken);
  const keyboard = useKeyboardLift();
  const submitLock = useRef(createSingleFlight());
  const finished = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (finished.current) {
      return;
    }
    void rememberRegistrationDraft({ fullName, address: '' });
  }, [fullName]);

  async function handleSubmit() {
    if (!submitLock.current.enter()) {
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await complete(fullName, '');
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
    <KeyboardFieldFocusContext.Provider value={keyboard.revealFocusedField}>
    <ScrollView
      ref={keyboard.scrollRef}
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + keyboard.keyboardInset }]}
      keyboardShouldPersistTaps="handled"
      onScroll={(event) => {
        keyboard.onScroll(event.nativeEvent.contentOffset.y);
      }}
      scrollEventThrottle={16}
    >
      <Text style={styles.title}>Your details</Text>
      <Text style={styles.subtitle}>Your number is verified. Add the details for this customer account.</Text>
      {verifiedPhone ? (
        <View style={styles.verifiedNumber}>
          <View style={styles.verifiedCopy}>
            <Text style={styles.verifiedLabel}>Verified mobile number</Text>
            <View style={styles.verifiedPhone}>
              {verifiedPhone.startsWith('+263') ? (
                <Image source={require('../../../../../assets/zimbabwe-flag.png')} style={styles.flag} resizeMode="cover" />
              ) : null}
              <Text style={styles.verifiedValue}>{verifiedPhone}</Text>
            </View>
          </View>
          <View style={styles.verifiedBadge}>
            <MaterialDesignIcons name="check" size={14} color={colors.primary} />
            <Text style={styles.verifiedBadgeLabel}>Verified</Text>
          </View>
        </View>
      ) : null}
      <FormInput
        label="Full name"
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        editable={!isLoading}
        error={registrationNameFieldError(error)}
      />
      <ErrorMessage message={registrationNameFieldError(error) ? null : error} />
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
    </KeyboardFieldFocusContext.Provider>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
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
  verifiedNumber: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  verifiedCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  verifiedBadgeLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
  verifiedLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  verifiedPhone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flag: {
    width: 28,
    height: 22,
    borderRadius: 2,
  },
  verifiedValue: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
});
}
