import { registerRootComponent } from 'expo';
import { TurboModuleRegistry } from 'react-native';

import App from './App';

// Installs the Crashlytics JavaScript handler only after a native build that
// includes the module. It does not set a user id or record custom logs.
try {
  if (TurboModuleRegistry.get('NativeRNFBTurboCrashlytics') != null) {
    require('@react-native-firebase/crashlytics');
  }
} catch {
  // The installed development client was built before Crashlytics was added.
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
