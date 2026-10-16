import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CustomerAvatar from '../../../../components/CustomerAvatar';
import PrimaryButton from '../../../../components/PrimaryButton';
import { colors, spacing, typography } from '../../../../theme';
import { customerFirstName, customerGreeting } from '../../../account/domain/customerGreeting';
import { useCustomerAccount } from '../../../account/presentation/viewmodels/useCustomerAccount';
import { useSession } from '../viewmodels/useSession';

export default function CustomerHomeScreen() {
  const { accessToken } = useSession();
  const { account } = useCustomerAccount(accessToken);
  const [notice, setNotice] = useState<string | null>(null);
  const firstName = account ? customerFirstName(account) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>Dashboard</Text>
      {account ? (
        <View style={styles.heading}>
          <CustomerAvatar
            kind={account.kind}
            name={account.name}
            customerId={account.id}
            photoUrl={account.photoUrl}
            size={64}
          />
          <View style={styles.greetingBlock}>
            <Text style={styles.greeting}>{customerGreeting(new Date())}</Text>
            {firstName ? <Text style={styles.name}>{firstName}</Text> : null}
          </View>
        </View>
      ) : null}
      <Text style={styles.subtitle}>
        Request a motorcycle delivery when you are ready.
      </Text>
      <PrimaryButton
        label="New delivery request"
        icon="motorbike"
        onPress={() => setNotice('Delivery requests are not available yet.')}
      />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.spacer} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  greetingBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  greeting: {
    fontSize: typography.heading,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  name: {
    fontSize: typography.body,
    fontWeight: '400',
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.xxl,
  },
  notice: {
    marginTop: spacing.lg,
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  spacer: {
    flex: 1,
  },
});
