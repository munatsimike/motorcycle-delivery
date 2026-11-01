import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { useCustomerProfilePhoto } from '../viewmodels/useCustomerProfilePhoto';

type ProfileNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Profile'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type IconName = ComponentProps<typeof MaterialDesignIcons>['name'];

export default function ProfileScreen() {
  const { accessToken, logout } = useSession();
  const { account, isLoading, error } = useCustomerAccount(accessToken);
  const photo = useCustomerProfilePhoto(accessToken, account);
  const navigation = useNavigation<ProfileNavigation>();
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);
  const kindLabel = account?.kind === 'BUSINESS' ? 'Business' : 'Individual';

  async function handleLogout() {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GreenSurface style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
          {account ? (
            <>
              <View style={styles.avatarWrap}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change profile photo"
                  disabled={photo.phase !== 'idle'}
                  onPress={() => {
                    void photo.changePhoto();
                  }}
                >
                  <CustomerAvatar
                    kind={account.kind}
                    name={account.name}
                    customerId={account.id}
                    photoUrl={photo.uri}
                    size={80}
                  />
                </Pressable>
                {photo.phase === 'idle' && (account.hasProfilePhoto || photo.uri) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    hitSlop={8}
                    onPress={() => {
                      Alert.alert(
                        'Remove profile photo?',
                        'Your initials will be shown instead.',
                        [
                          { text: 'Keep photo', style: 'cancel' },
                          {
                            text: 'Remove photo',
                            style: 'destructive',
                            onPress: () => {
                              void photo.removePhoto();
                            },
                          },
                        ],
                      );
                    }}
                    style={styles.removePhoto}
                  >
                    <MaterialDesignIcons name="trash-can-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>
              {photo.phase === 'uploading' ? (
                <Text style={styles.photoStatus}>Uploading {photo.progress ?? 0}%</Text>
              ) : null}
              {photo.phase === 'removing' ? <Text style={styles.photoStatus}>Removing photo</Text> : null}
              <Text style={styles.name}>{account.name}</Text>
              <View style={styles.kind}>
                <MaterialDesignIcons
                  name={account.kind === 'BUSINESS' ? 'office-building-outline' : 'account-outline'}
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
              <InfoRow icon="phone-outline" label="WhatsApp number" value={account.phone} />
              {account.email ? <InfoRow icon="email-outline" label="Email address" value={account.email} /> : null}
              <ProfileDivider />
              <InfoRow
                icon="map-marker-outline"
                label="Address"
                value={account.address}
                onEdit={() => navigation.navigate('EditProfile', { account })}
              />
              {account.contactName ? (
                <InfoRow icon="account-outline" label="Contact person" value={account.contactName} />
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.body}>
        {isLoading ? <LoadingIndicator /> : null}
        {!isLoading && error ? <ErrorMessage message={error} /> : null}
        {photo.error ? <ErrorMessage message={photo.error} /> : null}

        <View style={styles.edit}>
          <SecondaryButton
            label="Log out"
            icon="logout"
            tone="danger"
            bordered={false}
            loading={signingOut}
            disabled={signingOut}
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

function ProfileDivider() {
  return (
    <LinearGradient
      colors={['transparent', colors.border, 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.divider}
    />
  );
}

function InfoRow({
  icon,
  label,
  value,
  onEdit,
}: {
  icon: IconName;
  label: string;
  value: string;
  onEdit?: () => void;
}) {
  return (
    <View style={styles.row}>
      <MaterialDesignIcons name={icon} size={20} color={colors.text} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      {onEdit ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} hitSlop={8} onPress={onEdit}>
          <MaterialDesignIcons name="pencil-outline" size={20} color={colors.text} />
        </Pressable>
      ) : null}
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  overlap: {
    marginTop: -spacing.xxxl,
    marginHorizontal: spacing.lg,
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
  avatarWrap: {
    width: 80,
    height: 80,
    marginBottom: spacing.sm,
  },
  photoStatus: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.primaryDark,
    textAlign: 'center',
  },
  removePhoto: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    boxShadow: '0 2px 6px rgba(23, 33, 29, 0.16)',
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
    fontWeight: '400',
    color: colors.primaryDark,
  },
  edit: {
    marginHorizontal: spacing.lg,
    gap: spacing.md,
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
  divider: {
    height: 1,
    marginLeft: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
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
    fontWeight: '400',
    color: colors.text,
  },
  passwordHint: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  saved: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.primaryDark,
    marginBottom: spacing.md,
  },
});
