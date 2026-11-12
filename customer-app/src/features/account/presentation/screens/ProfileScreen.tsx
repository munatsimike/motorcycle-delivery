import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheetModal from '../../../../components/BottomSheetModal';
import DialogModal, { DialogActions, DialogBody, DialogTextButton, DialogTitle } from '../../../../components/DialogModal';
import CustomerAvatar from '../../../../components/CustomerAvatar';
import ErrorMessage from '../../../../components/ErrorMessage';
import LoadingIndicator from '../../../../components/LoadingIndicator';
import SecondaryButton from '../../../../components/SecondaryButton';
import type { CustomerTabParamList, RootStackParamList } from '../../../../navigation/types';
import type { Palette } from '../../../../theme';
import { appearanceLabel, radius, spacing, typography, useAppearance, type AppearanceMode } from '../../../../theme';
import { useSession } from '../../../auth/presentation/viewmodels/useSession';
import { useCustomerAccount } from '../viewmodels/useCustomerAccount';
import { useCustomerProfilePhoto } from '../viewmodels/useCustomerProfilePhoto';

type ProfileNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<CustomerTabParamList, 'Profile'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type IconName = ComponentProps<typeof MaterialDesignIcons>['name'];

const APPEARANCE_OPTIONS: { mode: AppearanceMode; icon: IconName }[] = [
  { mode: 'system', icon: 'cellphone' },
  { mode: 'light', icon: 'weather-sunny' },
  { mode: 'dark', icon: 'weather-night' },
];

export default function ProfileScreen() {
  const { colors, mode, scheme, setMode } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { accessToken, logout } = useSession();
  const { account, isLoading, error } = useCustomerAccount(accessToken);
  const photo = useCustomerProfilePhoto(accessToken, account);
  const navigation = useNavigation<ProfileNavigation>();
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
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
      <View pointerEvents="none" style={styles.profileMap}>
        <Image
          source={require('../../../../../assets/map.png')}
          style={styles.profileMap}
          resizeMode="cover"
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>
      <LinearGradient
        pointerEvents="none"
        colors={scheme === 'dark'
          ? ['rgba(22,53,42,0.9)', 'rgba(16,22,20,0.72)', 'rgba(16,22,20,0.2)']
          : ['rgba(201,239,217,0.72)', 'rgba(229,247,238,0.35)', 'rgba(247,252,249,0.55)']}
        locations={[0, 0.62, 1]}
        style={styles.profileMapWash}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sheetAnchor}>
        <View style={[styles.sheet, account ? styles.sheetOverlap : null]}>
          {account ? (
            <View style={styles.identity}>
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
            </View>
          ) : (
            <Text style={styles.name}>Profile</Text>
          )}

          {account ? (
            <View style={styles.settingCard}>
              <InfoRow icon="phone-outline" label="WhatsApp number" value={account.phone} />
              {account.email ? (
                <>
                  <ProfileDivider />
                  <InfoRow icon="email-outline" label="Email address" value={account.email} />
                </>
              ) : null}
              {account.contactName ? (
                <>
                  <ProfileDivider />
                  <InfoRow icon="account-outline" label="Contact person" value={account.contactName} />
                </>
              ) : null}
              <ProfileDivider />
              <InfoRow
                icon="theme-light-dark"
                label="Appearance"
                value={appearanceLabel(mode)}
                chevron="up"
                onPress={() => setAppearanceOpen(true)}
              />
            </View>
          ) : null}

          {isLoading ? <LoadingIndicator /> : null}
          {!isLoading && error ? <ErrorMessage message={error} /> : null}
          {photo.error ? <ErrorMessage message={photo.error} /> : null}

          <SecondaryButton
            label="Log out"
            icon="logout"
            tone="danger"
            weight="regular"
            bordered={false}
            loading={signingOut}
            disabled={signingOut}
            onPress={() => {
              void handleLogout();
            }}
          />
        </View>
        {account ? (
          <View pointerEvents="box-none" style={styles.avatarSlot}>
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
                  onPress={() => setRemoveOpen(true)}
                  style={styles.removePhoto}
                >
                  <MaterialDesignIcons name="trash-can-outline" size={18} color={colors.error} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
        </View>
      </ScrollView>
      <DialogModal visible={removeOpen} onClose={() => setRemoveOpen(false)} closeLabel="Keep photo">
        <DialogTitle>Remove profile photo?</DialogTitle>
        <DialogBody>Your initials will be shown instead.</DialogBody>
        <DialogActions>
          <DialogTextButton label="Keep photo" tone="neutral" onPress={() => setRemoveOpen(false)} />
          <DialogTextButton
            label="Remove photo"
            tone="danger"
            onPress={() => {
              setRemoveOpen(false);
              void photo.removePhoto();
            }}
          />
        </DialogActions>
      </DialogModal>
      <BottomSheetModal visible={appearanceOpen} onClose={() => setAppearanceOpen(false)} closeLabel="Close appearance">
        <View style={[styles.appearanceSheet, { paddingBottom: spacing.lg + insets.bottom }]}>
          <Text style={styles.appearanceTitle}>Appearance</Text>
          <View accessibilityRole="radiogroup">
            {APPEARANCE_OPTIONS.map((option) => {
              const selected = option.mode === mode;
              const selectedColor = colors.background === '#FFFFFF' ? colors.primaryDark : colors.primary;
              return (
                <Pressable
                  key={option.mode}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setMode(option.mode);
                    setAppearanceOpen(false);
                  }}
                  style={[styles.appearanceOption, selected && styles.appearanceOptionSelected]}
                >
                  <MaterialDesignIcons
                    name={option.icon}
                    size={20}
                    color={selected ? selectedColor : colors.textSecondary}
                  />
                  <Text style={[styles.appearanceOptionLabel, selected && styles.appearanceOptionLabelSelected]}>
                    {appearanceLabel(option.mode)}
                  </Text>
                  <View style={[styles.appearanceRadio, selected && styles.appearanceRadioSelected]}>
                    {selected ? <MaterialDesignIcons name="check" size={14} color={colors.textInverse} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </BottomSheetModal>
    </View>
  );
}

function ProfileDivider() {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.divider} />;
}

function InfoRow({
  icon,
  label,
  value,
  onEdit,
  onPress,
  chevron,
}: {
  icon: IconName;
  label: string;
  value: string;
  onEdit?: () => void;
  onPress?: () => void;
  chevron?: 'up';
}) {
  const { colors } = useAppearance();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={styles.row}
      >
      <MaterialDesignIcons name={icon} size={18} color={colors.text} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      {onEdit ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} hitSlop={8} onPress={onEdit}>
          <MaterialDesignIcons name="pencil-outline" size={20} color={colors.text} />
        </Pressable>
      ) : chevron === 'up' ? (
        <MaterialDesignIcons name="chevron-up" size={22} color={colors.textSecondary} />
      ) : null}
    </Pressable>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  profileMap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  profileMapWash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  content: {
    flexGrow: 1,
  },
  sheetAnchor: {
    flexGrow: 1,
  },
  sheet: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  sheetOverlap: {
    marginTop: 40,
    paddingTop: 40 + spacing.sm,
  },
  avatarSlot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  identity: {
    alignItems: 'center',
    gap: spacing.sm,
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
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  kindText: {
    fontSize: typography.caption,
    fontWeight: '400',
    color: colors.primaryDark,
  },
  settingCard: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 30,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
  appearanceSheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  appearanceTitle: {
    fontSize: typography.heading,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.text,
  },
  appearanceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  appearanceOptionSelected: {
    backgroundColor: colors.background === '#FFFFFF' ? colors.surface : colors.primaryLight,
  },
  appearanceOptionLabel: {
    flex: 1,
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.text,
  },
  appearanceOptionLabelSelected: {
    fontWeight: '600',
    color: colors.background === '#FFFFFF' ? colors.primaryDark : colors.primary,
  },
  appearanceRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appearanceRadioSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
}
