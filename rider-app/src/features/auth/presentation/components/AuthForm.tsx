import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BrandLogo from '../../../../components/BrandLogo';
import ErrorMessage from '../../../../components/ErrorMessage';
import FormInput from '../../../../components/FormInput';
import PrimaryButton from '../../../../components/PrimaryButton';
import ZimbabwePhoneField from '../../../../components/ZimbabwePhoneField';
import RegistrationAddressField from './RegistrationAddressField';
import { colors, spacing, typography } from '../../../../theme';

type AuthFormProps = {
  title: string;
  subtitle: string;
  buttonLabel: string;
  isLoading: boolean;
  error: string | null;
  phone: string;
  onChangePhone: (value: string) => void;
  onSubmit: () => void;
  footerText: string;
  footerAction: string;
  onFooterPress: () => void;
  helperText?: string | null;
  fullName?: string;
  onChangeFullName?: (value: string) => void;
  address?: string;
  onChangeAddress?: (value: string) => void;
};

export default function AuthForm({
  title,
  subtitle,
  buttonLabel,
  isLoading,
  error,
  phone,
  onChangePhone,
  onSubmit,
  footerText,
  footerAction,
  onFooterPress,
  helperText = null,
  fullName,
  onChangeFullName,
  address,
  onChangeAddress,
}: AuthFormProps) {
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <BrandLogo style={styles.logo} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {onChangeFullName ? (
          <FormInput
            label="Full name"
            value={fullName ?? ''}
            onChangeText={onChangeFullName}
            placeholder="Your full name"
            autoComplete="name"
            textContentType="name"
            maxLength={200}
            editable={!isLoading}
          />
        ) : null}
        {onChangeAddress ? (
          <RegistrationAddressField
            value={address ?? ''}
            onChangeText={onChangeAddress}
            editable={!isLoading}
          />
        ) : null}
        <ZimbabwePhoneField value={phone} onChangeText={onChangePhone} editable={!isLoading} />
        {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
        <ErrorMessage message={error} />
        <PrimaryButton
          label={buttonLabel}
          onPress={onSubmit}
          loading={isLoading}
          loadingLabel="Processing"
        />
        <View style={styles.footer}>
          <Text style={styles.footerText}>{footerText}</Text>
          <Pressable accessibilityRole="button" onPress={onFooterPress} disabled={isLoading}>
            <Text style={styles.footerAction}>{footerAction}</Text>
          </Pressable>
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
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  logo: {
    marginBottom: spacing.xxl,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.body,
    lineHeight: 24,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  helper: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  footerAction: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
