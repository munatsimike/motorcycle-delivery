import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BrandMark from '../../../../components/BrandMark';
import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { colors, spacing, typography } from '../../../../theme';
import { useSession } from '../viewmodels/useSession';

export default function UnlockScreen() {
  const { status, biometricAvailable, unlock, retryRestore, logout } = useSession();
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompted = useRef(false);
  const needsConnection = status === 'needsConnection';
  const canUseBiometric = biometricAvailable && !needsConnection;

  useEffect(() => {
    if (!canUseBiometric || prompted.current) {
      return;
    }
    prompted.current = true;
    void handleUnlock();
  }, [canUseBiometric]);

  async function handleUnlock() {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    setError(null);
    const result = await unlock();
    if (result === 'cancelled') {
      setError('Biometric unlock was cancelled.');
    } else if (result === 'offline') {
      setError('Riders could not reach the server. Your session is still on this phone.');
    }
    setIsWorking(false);
  }

  async function handleRetry() {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    setError(null);
    await retryRestore();
    setIsWorking(false);
  }

  async function handleUsePhone() {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    await logout();
  }

  const title = canUseBiometric ? 'Unlock Riders' : 'Sign in again';
  const subtitle = canUseBiometric
    ? 'Confirm it is you to open the session already stored on this phone.'
    : needsConnection
      ? 'This phone is offline, so Riders cannot confirm the saved session yet.'
      : 'Biometric unlock is no longer available on this phone.';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <BrandMark style={styles.brand} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <ErrorMessage message={error} />
      {canUseBiometric ? (
        <PrimaryButton
          label="Unlock"
          icon="fingerprint"
          onPress={() => {
            void handleUnlock();
          }}
          loading={isWorking}
        />
      ) : needsConnection ? (
        <PrimaryButton
          label="Try again"
          icon="refresh"
          onPress={() => {
            void handleRetry();
          }}
          loading={isWorking}
        />
      ) : null}
      <View style={styles.signOut}>
        <SecondaryButton
          label="Use phone number instead"
          icon="phone"
          onPress={() => {
            void handleUsePhone();
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
  signOut: {
    marginTop: spacing.md,
  },
});
