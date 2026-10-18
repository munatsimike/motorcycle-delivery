import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BrandMark from '../../../../components/BrandMark';
import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { colors, spacing, typography } from '../../../../theme';
import { useSession } from '../viewmodels/useSession';

export default function UnlockScreen() {
  const { unlock, logout } = useSession();
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock() {
    if (isUnlocking) {
      return;
    }
    setIsUnlocking(true);
    setError(null);
    const unlocked = await unlock();
    if (!unlocked) {
      setError('Biometric unlock was cancelled.');
    }
    setIsUnlocking(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <BrandMark style={styles.brand} />
      <Text style={styles.title}>Unlock Riders</Text>
      <Text style={styles.subtitle}>
        Confirm it's you to open the session already stored on this phone.
      </Text>
      <ErrorMessage message={error} />
      <PrimaryButton
        label="Unlock"
        icon="fingerprint"
        onPress={() => {
          void handleUnlock();
        }}
        loading={isUnlocking}
      />
      <View style={styles.signOut}>
        <SecondaryButton
          label="Log out"
          icon="logout"
          tone="danger"
          onPress={() => {
            void logout();
          }}
          disabled={isUnlocking}
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
