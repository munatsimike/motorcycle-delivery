import { Pressable, StyleSheet, Text, View } from 'react-native';

import FormInput from '../../../../components/FormInput';
import { colors, radius, spacing, typography } from '../../../../theme';
import {
  DELIVERY_PAYERS,
  PARCEL_SIZES,
  PAYMENT_METHODS,
  type BookingDraft,
  type DeliveryPayer,
  type ParcelSize,
  type PaymentMethod,
} from '../../domain/bookingDraft';

type ParcelFieldsProps = {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
};

const SIZE_LABELS: Record<ParcelSize, string> = {
  SMALL: 'Small',
  MEDIUM: 'Medium',
  LARGE: 'Large',
};

const PAYER_LABELS: Record<DeliveryPayer, string> = {
  SENDER: 'I will pay',
  RECIPIENT: 'Recipient will pay',
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  ECOCASH: 'EcoCash',
  ONEMONEY: 'OneMoney',
  INNBUCKS: 'InnBucks',
  ZIPIT: 'ZIPIT',
};

export default function ParcelFields({ draft, onChange }: ParcelFieldsProps) {
  return (
    <>
      <FormInput
        label="Description"
        value={draft.description}
        onChangeText={(description) => onChange({ description })}
        maxLength={500}
      />
      <ChoiceGroup
        label="Parcel size"
        value={draft.size}
        options={PARCEL_SIZES.map((size) => ({ value: size, label: SIZE_LABELS[size] }))}
        onChange={(size) => onChange({ size })}
      />
      <FormInput
        label="Instructions (optional)"
        value={draft.instructions}
        onChangeText={(instructions) => onChange({ instructions })}
        maxLength={500}
      />
      <ChoiceGroup
        label="Who pays the rider"
        value={draft.payer}
        options={DELIVERY_PAYERS.map((payer) => ({ value: payer, label: PAYER_LABELS[payer] }))}
        onChange={(payer) => onChange({ payer })}
      />
      <ChoiceGroup
        label="How the rider will be paid"
        value={draft.paymentMethod}
        options={PAYMENT_METHODS.map((method) => ({ value: method, label: PAYMENT_LABELS[method] }))}
        onChange={(paymentMethod) => onChange({ paymentMethod })}
      />
      <Text style={styles.note}>Payment is not collected in the app. The rider is paid using the method you choose.</Text>
    </>
  );
}

export function parcelSizeLabel(size: ParcelSize): string {
  return SIZE_LABELS[size];
}

export function payerLabel(payer: DeliveryPayer): string {
  return PAYER_LABELS[payer];
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_LABELS[method];
}

type ChoiceGroupProps<T extends string> = {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
};

function ChoiceGroup<T extends string>({ label, value, options, onChange }: ChoiceGroupProps<T>) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.choice, selected && styles.choiceSelected]}
          >
            <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  groupLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
  },
  choiceSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  choiceLabel: {
    fontSize: typography.body,
    color: colors.text,
  },
  choiceLabelSelected: {
    fontWeight: '700',
  },
  note: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
});
