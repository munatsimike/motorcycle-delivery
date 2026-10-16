import { StyleSheet, Text } from 'react-native';

import FormInput from '../../../../components/FormInput';
import ZimbabwePhoneField from '../../../../components/ZimbabwePhoneField';
import { colors, spacing, typography } from '../../../../theme';
import type { StopDraft } from '../../domain/bookingDraft';

type StopFieldsProps = {
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
};

export default function StopFields({ stop, onChange }: StopFieldsProps) {
  return (
    <>
      <Text style={styles.note}>
        Map selection is not available. Enter the street address and the coordinates for that place.
      </Text>
      <FormInput
        label="Address"
        value={stop.address}
        onChangeText={(address) => onChange({ address })}
        textContentType="fullStreetAddress"
        maxLength={500}
      />
      <FormInput
        label="Landmark (optional)"
        value={stop.landmark}
        onChangeText={(landmark) => onChange({ landmark })}
        maxLength={200}
      />
      <FormInput
        label="Instructions (optional)"
        value={stop.instructions}
        onChangeText={(instructions) => onChange({ instructions })}
        maxLength={500}
      />
      <FormInput
        label="Contact name"
        value={stop.contactName}
        onChangeText={(contactName) => onChange({ contactName })}
        textContentType="name"
        maxLength={200}
      />
      <ZimbabwePhoneField
        label="Contact phone"
        value={stop.contactPhone}
        onChangeText={(contactPhone) => onChange({ contactPhone })}
      />
      <FormInput
        label="Latitude"
        value={stop.latitude}
        onChangeText={(latitude) => onChange({ latitude })}
        autoComplete="off"
        maxLength={20}
      />
      <FormInput
        label="Longitude"
        value={stop.longitude}
        onChangeText={(longitude) => onChange({ longitude })}
        autoComplete="off"
        maxLength={20}
      />
    </>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
});
