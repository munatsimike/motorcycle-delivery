import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BrandMark from '../../../../components/BrandMark';
import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { colors, spacing, typography } from '../../../../theme';
import { useSession } from '../viewmodels/useSession';

export default function BiometricOfferScreen() {
  const { acceptBiometricOffer, declineBiometricOffer } = useSession();
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enable() {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    setError(null);
    const result = await acceptBiometricOffer();
    if (result === 'cancelled') {
      setError('Biometric sign-in was cancelled.');
    } else if (result === 'unavailable') {
      setError('Set up fingerprint or face unlock in phone settings, then try again.');
    }
    setIsWorking(false);
  }

  async function skip() {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    await declineBiometricOffer();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <BrandMark style={styles.brand} />
      <Text style={styles.title}>Sign in faster next time</Text>
      <Text style={styles.subtitle}>
        Use Face ID or fingerprint to open Riders on this phone. You can still use your phone number later.
      </Text>
      <ErrorMessage message={error} />
      <PrimaryButton
        label="Enable"
        icon="fingerprint"
        onPress={() => {
          void enable();
        }}
        loading={isWorking}
      />
      <View style={styles.later}>
        <SecondaryButton
          label="Not now"
          onPress={() => {
            void skip();
          }}
          disabled={isWorking}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  brand: {
    marginBottom: spacing.xxxl,
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
  later: {
    marginTop: spacing.md,
  },
});
