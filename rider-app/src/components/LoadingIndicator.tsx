import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '../theme';

export default function LoadingIndicator() {
  return (
    <View style={styles.container}>
      <ActivityIndicator accessibilityLabel="Loading" size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
