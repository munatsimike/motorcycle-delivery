import FormInput from '../../../../components/FormInput';
import ZimbabwePhoneField from '../../../../components/ZimbabwePhoneField';
import type { StopDraft } from '../../domain/bookingDraft';

type StopFieldsProps = {
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
  showLandmark?: boolean;
};

export default function StopFields({ stop, onChange, showLandmark = true }: StopFieldsProps) {
  return (
    <>
      <FormInput
        label="Address"
        value={stop.address}
        onChangeText={(address) => onChange({ address })}
        textContentType="fullStreetAddress"
        maxLength={500}
      />
      {showLandmark ? (
        <FormInput
          label="Landmark (optional)"
          value={stop.landmark}
          onChangeText={(landmark) => onChange({ landmark })}
          maxLength={200}
        />
      ) : null}
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
        label="Instructions (optional)"
        value={stop.instructions}
        onChangeText={(instructions) => onChange({ instructions })}
        maxLength={500}
      />
    </>
  );
}
