import FormInput from '../../../../components/FormInput';
import ZimbabwePhoneField from '../../../../components/ZimbabwePhoneField';
import type { StopDraft } from '../../domain/bookingDraft';

type StopFieldsProps = {
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
  showLandmark?: boolean;
  showInstructions?: boolean;
};

export default function StopFields({
  stop,
  onChange,
  showLandmark = true,
  showInstructions = true,
}: StopFieldsProps) {
  const dutch = stop.contactPhone.replace(/[\s()-]/g, '').startsWith('+31');
  const national = dutch ? stop.contactPhone.replace(/[\s()-]/g, '').slice(3) : stop.contactPhone;

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
        countryCode={dutch ? '+31' : '+263'}
        value={national}
        onChangeText={(next) => {
          const digits = next.replace(/\D/g, '');
          onChange({ contactPhone: dutch ? `+31${digits}` : digits });
        }}
      />
      {showInstructions ? (
        <FormInput
          label="Instructions for the rider (optional)"
          value={stop.instructions}
          onChangeText={(instructions) => onChange({ instructions })}
          maxLength={500}
        />
      ) : null}
    </>
  );
}
