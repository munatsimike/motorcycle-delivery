
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationContainer } from '@react-navigation/native';
import { colors, spacing, typography, radius } from '../theme';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import BrandLogo from '../components/BrandLogo';
import LoadingIndicator from '../components/LoadingIndicator';
import PrimaryButton from '../components/PrimaryButton';
import SecondaryButton from '../components/SecondaryButton';
import SignUpScreen from '../features/auth/SignupScreen';
import CustomerTabs from './CustomerTabs';
import ParcelRequestScreen from '../features/deliveries/presentation/screens/ParcelRequestScreen';
import DeliveryTrackingScreen from '../features/deliveries/presentation/screens/DeliveryTrackingScreen';
import OtpVerificationScreen from '../features/auth/presentation/screens/OtpVerificationScreen';
import RegistrationFormScreen from '../features/auth/presentation/screens/RegistrationFormScreen';
import SignInScreen from '../features/auth/presentation/screens/SignInScreen';
import UnlockScreen from '../features/auth/presentation/screens/UnlockScreen';
import { useSession } from '../features/auth/presentation/viewmodels/useSession';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Sampled from the top of the rider photo so the logo area meets the image.
const welcomeBackdrop = '#F1F7F3';

type WelcomeProps = NativeStackScreenProps<
  RootStackParamList,
  'Welcome'
>;

function WelcomeScreen({ navigation }: WelcomeProps) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <BrandLogo style={styles.logo} />

      <View style={styles.hero}>
        <Image
          source={require('../../assets/riders-motorcycle.png')}
          style={styles.photo}
          resizeMode="contain"
        />
        <LinearGradient
          colors={['transparent', welcomeBackdrop]}
          style={styles.photoBottomFade}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[welcomeBackdrop, 'transparent']}
          start={{ x: 0, y: 1 }}
          end={{ x: 0.7, y: 0.15 }}
          style={styles.photoCornerFade}
          pointerEvents="none"
        />
      </View>

      <View style={[styles.panel, { paddingBottom: spacing.lg + insets.bottom }]}>
        <LinearGradient
          colors={[welcomeBackdrop, colors.background]}
          style={styles.panelBlend}
        >
          <Text style={styles.heading}>
            Fast, Safe, and Always{'\n'}On Time
          </Text>
        </LinearGradient>
        <Text style={styles.description}>
          Trusted motorcycle deliveries for quick
          {'\n'}and secure parcel transport.
        </Text>
        <View style={styles.bottom}>
          <PrimaryButton
            label="Sign In →"
            onPress={() => navigation.navigate('SignIn')}
          />
          <SecondaryButton
            label="Sign Up"
            onPress={() => navigation.navigate('SignUp')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function AppNavigator() {
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        {status === 'signedIn' ? (
          <>
            <Stack.Screen
              name="CustomerHome"
              component={CustomerTabs}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ParcelRequest"
              component={ParcelRequestScreen}
              options={{ title: 'Send a Parcel' }}
            />
            <Stack.Screen
              name="DeliveryTracking"
              component={DeliveryTrackingScreen}
              options={{ title: 'Track Delivery' }}
            />
          </>
        ) : status === 'locked' ? (
          <Stack.Screen
            name="Unlock"
            component={UnlockScreen}
            options={{ headerShown: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Welcome"
              component={WelcomeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="SignIn"
              component={SignInScreen}
              options={{ title: 'Sign In' }}
            />
            <Stack.Screen
              name="SignUp"
              component={SignUpScreen}
              options={{ title: 'Sign Up' }}
            />
            <Stack.Screen
              name="OtpVerification"
              component={OtpVerificationScreen}
              options={{ title: 'Verify' }}
            />
            <Stack.Screen
              name="RegistrationForm"
              component={RegistrationFormScreen}
              options={{ title: 'Create account' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },

  screen: {
    flex: 1,
    backgroundColor: welcomeBackdrop,
  },

  logo: {
    paddingTop: spacing.xxl,
  },

  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },

  photo: {
    width: '100%',
    height: '100%',
  },

  photoBottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
  },

  photoCornerFade: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '62%',
    height: '58%',
  },

  panel: {
    backgroundColor: colors.background,
  },

  panelBlend: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },

  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },

  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.disabled,
  },

  activeDot: {
    width: 28,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },

  heading: {
    fontSize: typography.title,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    lineHeight: 32,
  },

  description: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    fontSize: typography.caption,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  bottom: {
    width: '100%',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },

  signInButton: {
    backgroundColor: colors.primary,
    minHeight: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  signUpButton: {
    width: '100%',
    minHeight: 56,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  signUpButtonText: {
    color: colors.primary,
    fontSize: typography.button,
    fontWeight: '700',
  },

  signInButtonText: {
    color: colors.textInverse,
    fontSize: typography.button,
    fontWeight: '700',
  },

  buttonPressed: {
    opacity: 0.8,
  },
});
