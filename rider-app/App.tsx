import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from './src/features/auth/presentation/viewmodels/useSession';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AppNavigator />
        <StatusBar style="dark" />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
