import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import LoadingIndicator from '../components/LoadingIndicator';
import OtpVerificationScreen from '../features/auth/presentation/screens/OtpVerificationScreen';
import RiderHomeScreen from '../features/auth/presentation/screens/RiderHomeScreen';
import SignInScreen from '../features/auth/presentation/screens/SignInScreen';
import SignUpScreen from '../features/auth/presentation/screens/SignUpScreen';
import { useSession } from '../features/auth/presentation/viewmodels/useSession';
import { colors } from '../theme';
import type { RootStackParamList } from './types';
import WelcomeScreen from './WelcomeScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
      <Stack.Navigator
        screenOptions={{
          headerTintColor: colors.primaryDark,
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {status === 'signedIn' ? (
          <Stack.Screen name="Home" component={RiderHomeScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: 'Sign in' }} />
            <Stack.Screen name="SignUp" component={SignUpScreen} options={{ title: 'Create account' }} />
            <Stack.Screen
              name="OtpVerification"
              component={OtpVerificationScreen}
              options={{ title: 'Verification code' }}
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
});
