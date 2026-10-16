import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CustomerAvatar from '../../../../components/CustomerAvatar';
import ErrorMessage from '../../../../components/ErrorMessage';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import PrimaryButton from '../../../../components/PrimaryButton';
import { colors, radius, spacing, typography } from '../../../../theme';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import { useCustomerAccount } from '../viewmodels/useCustomerAccount';

export default function ProfileScreen() {
  const {
    accessToken,
    logout,
    biometricEnabled,
    setBiometricEnabled,
  } = useSession();
  const { account, isLoading, error } = useCustomerAccount(accessToken);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUpdatingBiometric, setIsUpdatingBiometric] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleBiometric(enabled: boolean) {
    if (isUpdatingBiometric) {
      return;
    }
    setIsUpdatingBiometric(true);
    setBiometricError(null);
    try {
      const result = await setBiometricEnabled(enabled);
      if (result === 'unavailable') {
        setBiometricError('Set up fingerprint, face unlock, or a screen lock in phone settings, then try again.');
      } else if (result === 'cancelled') {
        setBiometricError('Biometric unlock was cancelled.');
      }
    } finally {
      setIsUpdatingBiometric(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>
        {isLoading ? <LoadingIndicator /> : null}
        {!isLoading && account ? (
          <View style={styles.card}>
            <CustomerAvatar
              kind={account.kind}
              name={account.name}
              customerId={account.id}
              photoUrl={account.photoUrl}
              size={88}
            />
            <Detail label="Account" value={account.kind === 'BUSINESS' ? 'Business' : 'Individual'} />
            <Detail label={account.kind === 'BUSINESS' ? 'Business name' : 'Name'} value={account.name} />
            {account.contactName ? <Detail label="Contact person" value={account.contactName} /> : null}
            <Detail label="Mobile number" value={account.phone} />
            <Detail label="Address" value={account.address} />
          </View>
        ) : null}
        {!isLoading && error ? <ErrorMessage message={error} /> : null}

        <View style={styles.biometric}>
          <Text style={styles.biometricLabel}>Unlock with biometrics</Text>
          <Switch
            value={biometricEnabled}
            disabled={isUpdatingBiometric}
            onValueChange={(enabled) => {
              void handleBiometric(enabled);
            }}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <ErrorMessage message={biometricError} />
        <PrimaryButton
          label="Log out"
          onPress={() => {
            void handleLogout();
          }}
          loading={isLoggingOut}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
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
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  detail: {
    gap: spacing.xs,
  },
  detailLabel: {
    fontSize: typography.small,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: typography.body,
    color: colors.text,
    lineHeight: 22,
  },
  biometric: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  biometricLabel: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
});
