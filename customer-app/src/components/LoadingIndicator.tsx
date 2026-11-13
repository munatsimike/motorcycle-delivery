import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppearance } from '../theme';

export default function LoadingIndicator() {
  const { colors } = useAppearance();
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
