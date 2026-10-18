import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CustomerAvatar from '../../../../components/CustomerAvatar';
import ErrorMessage from '../../../../components/ErrorMessage';
import GreenSurface from '../../../../components/GreenSurface';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import SecondaryButton from '../../../../components/SecondaryButton';
import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import { useCustomerAccount } from '../viewmodels/useCustomerAccount';

type ProfileNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Profile'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type IconName = ComponentProps<typeof MaterialDesignIcons>['name'];

export default function ProfileScreen() {
  const {
    accessToken,
    logout,
    biometricEnabled,
    setBiometricEnabled,
  } = useSession();
  const { account, isLoading, error } = useCustomerAccount(accessToken);
  const navigation = useNavigation<ProfileNavigation>();
  const insets = useSafeAreaInsets();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUpdatingBiometric, setIsUpdatingBiometric] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const kindLabel = account?.kind === 'BUSINESS' ? 'Business' : 'Individual';

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
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GreenSurface style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
          {account ? (
            <>
              <CustomerAvatar
                kind={account.kind}
                name={account.name}
                customerId={account.id}
                photoUrl={account.photoUrl}
                size={80}
              />
              <Text style={styles.name}>{account.name}</Text>
              <View style={styles.kind}>
                <MaterialDesignIcons
                  name={account.kind === 'BUSINESS' ? 'office-building' : 'account'}
                  size={16}
                  color={colors.primaryDark}
                />
                <Text style={styles.kindText}>{kindLabel}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.name}>Profile</Text>
          )}
        </GreenSurface>

        {account ? (
          <View style={styles.overlap}>
            <View style={styles.settingCard}>
              <InfoRow
                icon="phone"
                label="Mobile number"
                value={account.phone}
                iconColor="#3B6FE8"
                backgroundColor="#E8F1FF"
              />
              {account.email ? <InfoRow icon="email" label="Email address" value={account.email} /> : null}
              <InfoRow
                icon="map-marker"
                label="Address"
                value={account.address}
                iconColor={colors.primary}
                backgroundColor={colors.primaryLight}
              />
              {account.contactName ? (
                <InfoRow icon="account" label="Contact person" value={account.contactName} />
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.body}>
        {isLoading ? <LoadingIndicator /> : null}
        {!isLoading && error ? <ErrorMessage message={error} /> : null}

        {account ? (
          <View style={styles.edit}>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('EditProfile', { account })}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View style={styles.editButton}>
                <View style={styles.editLabelRow}>
                  <MaterialDesignIcons name="pencil" color={colors.textInverse} size={20} />
                  <Text style={styles.editLabel}>Edit Profile</Text>
                </View>
                <MaterialDesignIcons
                  name="chevron-right"
                  color={colors.textInverse}
                  size={22}
                  style={styles.editChevron}
                />
              </View>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.setting}>
            <View style={styles.iconBox}>
              <MaterialDesignIcons name="fingerprint" size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>Unlock with biometrics</Text>
              <Text style={styles.settingBody}>Use fingerprint or face unlock on this phone.</Text>
            </View>
            <Switch
              value={biometricEnabled}
              disabled={isUpdatingBiometric}
              onValueChange={(enabled) => {
                void handleBiometric(enabled);
              }}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>
        <ErrorMessage message={biometricError} />

        <View style={styles.edit}>
          <SecondaryButton
            label="Log out"
            icon="logout"
            tone="danger"
            loading={isLoggingOut}
            onPress={() => {
              void handleLogout();
            }}
          />
        </View>
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  iconColor = colors.primaryDark,
  backgroundColor = colors.background,
}: {
  icon: IconName;
  label: string;
  value: string;
  iconColor?: string;
  backgroundColor?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor }]}>
        <MaterialDesignIcons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  overlap: {
    marginTop: -spacing.xxxl,
    marginHorizontal: spacing.xl,
  },
  body: {
    marginTop: spacing.lg,
    gap: spacing.lg,
  },
  name: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  kindText: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  card: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  edit: {
    marginHorizontal: spacing.xl,
  },
  pressed: {
    opacity: 0.8,
  },
  editButton: {
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  editLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  editLabel: {
    color: colors.textInverse,
    fontSize: typography.button,
    fontWeight: '700',
  },
  editChevron: {
    position: 'absolute',
    right: spacing.lg,
  },
  settingCard: {
    backgroundColor: '#F8FAF9',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0 4px 16px rgba(23, 33, 29, 0.08)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  rowCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  rowLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  rowValue: {
    fontSize: typography.body,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
  },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  settingCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  settingTitle: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  settingBody: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
  },
});
