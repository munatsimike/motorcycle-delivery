import { LinearGradient } from 'expo-linear-gradient';
import { NavigationContainer } from '@react-navigation/native';
import { colors, spacing, typography } from '../theme';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '../components/useMotion';
import BrandLogo from '../components/BrandLogo';
import ErrorMessage from '../components/ErrorMessage';
import LoadingIndicator from '../components/LoadingIndicator';
import PrimaryButton from '../components/PrimaryButton';
import SecondaryButton from '../components/SecondaryButton';
import SignUpScreen from '../features/auth/SignupScreen';
import CustomerTabs from './CustomerTabs';
import EditProfileScreen from '../features/account/presentation/screens/EditProfileScreen';
import ParcelRequestScreen from '../features/deliveries/presentation/screens/ParcelRequestScreen';
import DeliveryTrackingScreen from '../features/deliveries/presentation/screens/DeliveryTrackingScreen';
import OtpVerificationScreen from '../features/auth/presentation/screens/OtpVerificationScreen';
import SignInScreen from '../features/auth/presentation/screens/SignInScreen';
import { useSession } from '../features/auth/presentation/viewmodels/useSession';
import { publishCustomerPush, useCustomerPush } from '../features/notifications/presentation/useCustomerPush';
import { navigationRef } from './navigationRef';
import { FORWARD_MS, motionDuration, STACK_ANIMATION } from './screenMotion';
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
  const { logoutNotice } = useSession();

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
          <ErrorMessage message={logoutNotice} />
        </LinearGradient>
        <Text style={styles.description}>
          Trusted motorcycle deliveries for quick
          {'\n'}and secure parcel transport.
        </Text>
        <View style={styles.bottom}>
          <PrimaryButton
            label="Sign In"
            trailingIcon="chevron-right"
            onPress={() => navigation.navigate('SignIn')}
          />
          <SecondaryButton
            label="Create account"
            soft
            onPress={() => navigation.navigate('SignUp')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function AppNavigator() {
  const { status, accessToken, customerId } = useSession();
  const signedIn = status === 'signedIn';
  useCustomerPush(signedIn, signedIn ? accessToken : null, signedIn ? customerId : null);

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <LoadingIndicator />
      </View>
    );
  }

  if (status === 'needsConnection') {
    return <ConnectionScreen />;
  }

  return (
    <NavigationContainer ref={navigationRef} onReady={publishCustomerPush}>
      <SessionSlide signedIn={signedIn}>
      <Stack.Navigator
        screenOptions={{
          animation: STACK_ANIMATION,
          animationDuration: FORWARD_MS,
          gestureEnabled: true,
        }}
      >
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
            <Stack.Screen
              name="EditProfile"
              component={EditProfileScreen}
              options={{ title: 'Edit Profile' }}
            />
          </>
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
              options={{ title: 'Create account' }}
            />
            <Stack.Screen
              name="OtpVerification"
              component={OtpVerificationScreen}
              options={{ title: 'Verify' }}
            />
          </>
        )}
      </Stack.Navigator>
      </SessionSlide>
    </NavigationContainer>
  );
}

function SessionSlide({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: ReactNode;
}) {
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(1)).current;
  const direction = useRef(1);
  const previous = useRef(signedIn);

  if (previous.current !== signedIn) {
    direction.current = signedIn ? 1 : -1;
    previous.current = signedIn;
    progress.setValue(motionDuration(FORWARD_MS, reduce) === 0 ? 1 : 0);
  }

  useEffect(() => {
    const duration = motionDuration(FORWARD_MS, reduce);
    if (duration === 0) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, reduce, signedIn]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [direction.current * width, 0],
  });

  return (
    <Animated.View style={[styles.session, { opacity: progress, transform: [{ translateX }] }]}>
      {children}
    </Animated.View>
  );
}

function ConnectionScreen() {
  const { retryRestore } = useSession();
  const [working, setWorking] = useState(false);

  return (
    <SafeAreaView style={styles.connection} edges={['top', 'bottom']}>
      <Text style={styles.connectionTitle}>You are offline</Text>
      <Text style={styles.connectionBody}>
        This phone is offline, so Riders cannot confirm the saved session yet.
      </Text>
      <PrimaryButton
        label="Try again"
        icon="refresh"
        loading={working}
        onPress={() => {
          setWorking(true);
          void retryRestore().finally(() => setWorking(false));
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  session: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  connection: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    gap: spacing.lg,
  },
  connectionTitle: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  connectionBody: {
    fontSize: typography.body,
    lineHeight: 24,
    color: colors.textSecondary,
  },

  screen: {
    flex: 1,
    backgroundColor: welcomeBackdrop,
  },

  logo: {
    alignSelf: 'center',
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
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
    paddingHorizontal: spacing.lg,
    fontSize: typography.caption,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  bottom: {
    width: '100%',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
});
