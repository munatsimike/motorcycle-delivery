import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ErrorMessage from '../../../../components/ErrorMessage';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { useRiderAvailability } from '../../../availability/presentation/useRiderAvailability';
import { locationStatusCopy } from '../../../availability/domain/locationStatus';
import { canGoOffline, canGoOnline } from '../../../availability/domain/sharingPolicy';
import { colors, radius, spacing, typography } from '../../../../theme';
import { useRiderHome } from '../viewmodels/useRiderHome';
import { useSession } from '../viewmodels/useSession';

export default function RiderHomeScreen() {
  const { displayName, logout } = useSession();
  const { onboarding, readiness, isLoading, error, reload } = useRiderHome();
  const availability = useRiderAvailability(onboarding, reload);
  const [signingOut, setSigningOut] = useState<'current' | 'all' | null>(null);
  const locationCopy = availability.snapshot.access === 'unknown'
    ? null
    : locationStatusCopy(availability.snapshot.access, availability.snapshot.sharing);
  const locationTitle = onboarding?.availability === 'BUSY'
    ? 'Location sharing is paused'
    : availability.snapshot.sharing
      ? 'Sharing your location'
      : locationCopy?.title ?? 'Checking location';
  const goOnlineAllowed = onboarding ? canGoOnline(onboarding) : false;
  const goOfflineAllowed = onboarding ? canGoOffline(onboarding) : false;

  async function signOut(scope: 'current' | 'all') {
    if (signingOut) {
      return;
    }
    setSigningOut(scope);
    try {
      await logout(scope);
    } finally {
      setSigningOut(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>Rider</Text>
        <Text style={styles.title}>{displayName ?? 'Rider'}</Text>
        <Text style={styles.subtitle}>Your account status on this phone.</Text>
        {isLoading && !onboarding ? <LoadingIndicator /> : null}
        <ErrorMessage message={error} />
        {error ? (
          <PrimaryButton label="Try again" onPress={() => { void reload(); }} />
        ) : null}
        {readiness ? (
          <View style={styles.card}>
            <StatusRow label="Approval" value={readiness.approvalLabel} />
            <StatusRow label="Licence" value={readiness.licenceLabel} />
            <StatusRow label="Availability" value={readiness.availabilityLabel} />
            {onboarding?.licenceNumber ? (
              <StatusRow label="Licence number" value={onboarding.licenceNumber} />
            ) : null}
            <Text style={styles.message}>{readiness.message}</Text>
          </View>
        ) : null}
        {onboarding && readiness ? (
          <View style={styles.availability}>
            <Text style={[
              styles.locationTitle,
              availability.snapshot.sharing && onboarding.availability !== 'BUSY' && styles.sharing,
            ]}>
              {locationTitle}
            </Text>
            <Text style={styles.locationDetail}>
              {onboarding.availability === 'BUSY'
                ? 'Location sharing pauses while you are on a delivery.'
                : locationCopy?.detail ?? 'Going online shares your location, including while this app is in the background, until you go offline.'}
            </Text>
            <ErrorMessage message={availability.actionError} />
            {goOnlineAllowed || onboarding.availability === 'OFFLINE' ? (
              <PrimaryButton
                label="Go Online"
                loading={availability.working}
                loadingLabel="Going online"
                disabled={!goOnlineAllowed || signingOut !== null}
                onPress={() => { void availability.online(); }}
              />
            ) : null}
            {goOfflineAllowed ? (
              <SecondaryButton
                label={availability.working ? 'Going offline' : 'Go Offline'}
                disabled={availability.working || signingOut !== null}
                onPress={() => { void availability.offline(); }}
              />
            ) : null}
            {availability.snapshot.access === 'services-off' ? (
              <SecondaryButton
                label="Turn on location"
                disabled={availability.working}
                onPress={() => { void availability.turnOnLocation(); }}
              />
            ) : null}
            {availability.snapshot.access === 'permission-blocked' ? (
              <SecondaryButton
                label="Allow location"
                disabled={availability.working}
                onPress={() => { void availability.allowLocation(); }}
              />
            ) : null}
          </View>
        ) : null}
        <View style={styles.actions}>
          <SecondaryButton
            label={signingOut === 'current' ? 'Signing out' : 'Sign out'}
            onPress={() => { void signOut('current'); }}
            disabled={signingOut !== null}
          />
          <SecondaryButton
            label={signingOut === 'all' ? 'Signing out' : 'Sign out everywhere'}
            onPress={() => { void signOut('all'); }}
            disabled={signingOut !== null}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
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
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  kicker: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowLabel: {
    color: colors.textSecondary,
    fontSize: typography.body,
  },
  rowValue: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  message: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 24,
    marginTop: spacing.sm,
  },
  availability: {
    gap: spacing.md,
  },
  locationTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  sharing: {
    color: colors.primary,
  },
  locationDetail: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 24,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
});
