import FormInput from '../../../../components/FormInput';
import ZimbabwePhoneField from '../../../../components/ZimbabwePhoneField';
import type { StopDraft } from '../../domain/bookingDraft';
import type { PlaceSuggestion, ResolvedPlace } from '../../domain/placeSuggestion';
import AddressField from './AddressField';

type StopFieldsProps = {
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
  searchPlaces: (text: string, sessionToken: string) => Promise<PlaceSuggestion[]>;
  resolvePlace: (placeId: string, sessionToken: string) => Promise<ResolvedPlace>;
  areaChoices?: PlaceSuggestion[];
  showLandmark?: boolean;
  showInstructions?: boolean;
};

export default function StopFields({
  stop,
  onChange,
  searchPlaces,
  resolvePlace,
  areaChoices = [],
  showLandmark = true,
  showInstructions = true,
}: StopFieldsProps) {
  const dutch = stop.contactPhone.replace(/[\s()-]/g, '').startsWith('+31');
  const national = dutch ? stop.contactPhone.replace(/[\s()-]/g, '').slice(3) : stop.contactPhone;

  return (
    <>
      <AddressField
        stop={stop}
        onChange={onChange}
        searchPlaces={searchPlaces}
        resolvePlace={resolvePlace}
        areaChoices={areaChoices}
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
