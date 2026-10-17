import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import BrandLogo from '../components/BrandLogo';
import PrimaryButton from '../components/PrimaryButton';
import SecondaryButton from '../components/SecondaryButton';
import type { RootStackParamList } from './types';
import { colors, spacing, typography } from '../theme';

type WelcomeProps = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

export default function WelcomeScreen({ navigation }: WelcomeProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <BrandLogo />
        <Text style={styles.heading}>Deliver with Riders</Text>
        <Text style={styles.description}>
          Sign in to see your rider account. Delivery requests will be added later.
        </Text>
      </View>
      <View style={styles.actions}>
        <PrimaryButton label="Sign in" onPress={() => navigation.navigate('SignIn')} />
        <SecondaryButton label="Create a rider account" onPress={() => navigation.navigate('SignUp')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  heading: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  description: {
    fontSize: typography.body,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.md,
  },
});
