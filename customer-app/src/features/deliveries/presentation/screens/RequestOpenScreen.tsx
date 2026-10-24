import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import PrimaryButton from '../../../../components/PrimaryButton';
import type { RootStackParamList } from '../../../../navigation/types';
import { colors, radius, spacing, typography } from '../../../../theme';
import { formatDeadline } from '../../domain/bookingDraft';
import { OPEN_FOR_BIDS } from '../../domain/openBidRequest';

type RequestOpenProps = NativeStackScreenProps<RootStackParamList, 'RequestOpen'>;

export default function RequestOpenScreen({ navigation, route }: RequestOpenProps) {
  const request = route.params;
  const deadline = formatDeadline(request.deliverBy);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.content}>
        <Text style={styles.title}>{OPEN_FOR_BIDS}</Text>
        <Text style={styles.body}>
          Riders can bid on this request. The suggested price is not a final price.
        </Text>
        <View style={styles.card}>
          <Text style={styles.label}>Service</Text>
          <Text style={styles.value}>{request.serviceClass === 'EXPRESS' ? 'Express' : 'Flexible'}</Text>
          <Text style={styles.label}>Deliver by</Text>
          <Text style={styles.value}>{deadline}</Text>
          <Text style={styles.label}>Suggested price</Text>
          <Text style={styles.value}>{request.currency} {request.suggestedPrice}</Text>
        </View>
        <PrimaryButton
          label="Done"
          onPress={() => navigation.navigate('CustomerHome', { screen: 'Requests' })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '800',
    color: colors.text,
  },
  body: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  label: {
    marginTop: spacing.sm,
    fontSize: typography.small,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  value: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
});
