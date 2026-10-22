import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useHeaderHeight } from '@react-navigation/elements';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import type { ComponentProps } from 'react';

import BrandMark from '../../../../components/BrandMark';
import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import ZimbabwePhoneField from '../../../../components/ZimbabwePhoneField';
import { looksLikeDutchPhoneEntry } from '../../domain/normalizePhone';
import { colors, spacing, typography } from '../../../../theme';

type PhoneEntryFormProps = {
  title: string;
  subtitle: string;
  buttonLabel: string;
  trailingIcon?: ComponentProps<typeof MaterialDesignIcons>['name'];
  isLoading: boolean;
  error: string | null;
  phone: string;
  onChangePhone: (value: string) => void;
  onSubmit: () => void;
  footerText: string;
  footerAction: string;
  onFooterPress: () => void;
  helperText?: string | null;
};

export default function PhoneEntryForm({
  title,
  subtitle,
  buttonLabel,
  trailingIcon,
  isLoading,
  error,
  phone,
  onChangePhone,
  onSubmit,
  footerText,
  footerAction,
  onFooterPress,
  helperText = 'Enter a Zimbabwe mobile number. We\'ll send a one-time SMS code.',
}: PhoneEntryFormProps) {
  const headerHeight = useHeaderHeight();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <BrandMark style={styles.logo} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <ZimbabwePhoneField
            value={phone}
            onChangeText={onChangePhone}
            editable={!isLoading}
            countryCode={typeof __DEV__ === 'boolean' && __DEV__ && looksLikeDutchPhoneEntry(phone) ? '+31' : '+263'}
          />
          {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
          <ErrorMessage message={error} />
          <PrimaryButton
            label={buttonLabel}
            trailingIcon={trailingIcon}
            onPress={onSubmit}
            loading={isLoading}
            loadingLabel="Processing"
          />
          <View style={styles.footer}>
            <Text style={styles.footerText}>{footerText}</Text>
            <Pressable onPress={onFooterPress} disabled={isLoading}>
              <Text style={styles.footerAction}>{footerAction}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  logo: {
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
    marginBottom: spacing.xxl,
  },
  helperText: {
    fontSize: typography.small,
    color: colors.textSecondary,
    lineHeight: 19,
    marginTop: -spacing.xs,
    marginBottom: spacing.xl,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxl,
  },
  footerText: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  footerAction: {
    fontSize: typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
});
