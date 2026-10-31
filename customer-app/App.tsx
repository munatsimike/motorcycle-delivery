import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NetworkNoticeProvider } from './src/components/NetworkNotice';
import { SessionProvider } from './src/features/auth/presentation/viewmodels/useSession';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <NetworkNoticeProvider>
        <SessionProvider>
          <AppNavigator />
          <StatusBar style="auto" />
        </SessionProvider>
      </NetworkNoticeProvider>
    </SafeAreaProvider>
  );
}