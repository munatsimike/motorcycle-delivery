import { type ComponentProps, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import FormInput from '../../../../components/FormInput';
import { colors, radius, spacing, typography } from '../../../../theme';
import type {
  BookingDraft,
  DeliveryPayer,
  ParcelSize,
  PaymentMethod,
} from '../../domain/bookingDraft';

type ParcelFieldsProps = {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
};

type IconName = ComponentProps<typeof MaterialDesignIcons>['name'];

const CONTENTS: { label: string; description: string; icon: IconName }[] = [
  { label: 'Parcel', description: 'Parcel', icon: 'package-variant' },
  { label: 'Document', description: 'Document', icon: 'file-document-outline' },
  { label: 'Food', description: 'Food', icon: 'silverware-fork-knife' },
];

const PAYERS: { value: DeliveryPayer; label: string }[] = [
  { value: 'SENDER', label: 'Sender' },
  { value: 'RECIPIENT', label: 'Recipient' },
];

const PAYMENTS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'ECOCASH', label: 'EcoCash' },
];

const PAYER_LABELS: Record<DeliveryPayer, string> = {
  SENDER: 'Sender',
  RECIPIENT: 'Recipient',
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  ECOCASH: 'EcoCash',
  ONEMONEY: 'OneMoney',
  INNBUCKS: 'InnBucks',
  ZIPIT: 'ZIPIT',
};

const SIZE_LABELS: Record<ParcelSize, string> = {
  SMALL: 'Small',
  MEDIUM: 'Medium',
  LARGE: 'Large',
};

export default function ParcelFields({ draft, onChange }: ParcelFieldsProps) {
  const selectedDescription = CONTENTS.some((content) => content.description === draft.description)
    ? draft.description
    : 'Parcel';

  useEffect(() => {
    const patch: Partial<BookingDraft> = {};
    if (draft.description !== selectedDescription) {
      patch.description = selectedDescription;
    }
    if (!draft.size) {
      patch.size = 'SMALL';
    }
    if (!draft.payer) {
      patch.payer = 'SENDER';
    }
    if (!draft.paymentMethod) {
      patch.paymentMethod = 'CASH';
    }
    if (Object.keys(patch).length > 0) {
      onChange(patch);
    }
  }, [draft.description, draft.payer, draft.paymentMethod, draft.size, onChange, selectedDescription]);

  return (
    <>
      <Text style={styles.groupLabel}>What are you sending</Text>
      <View style={styles.squares}>
        {CONTENTS.map((content) => {
          const selected = selectedDescription === content.description;
          return (
            <Pressable
              key={content.description}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange({ description: content.description, size: 'SMALL' })}
              style={styles.squarePress}
            >
              <View style={[styles.square, selected && styles.squareSelected]}>
                <MaterialDesignIcons
                  name={content.icon}
                  size={24}
                  color={selected ? colors.primaryDark : colors.text}
                />
                <Text style={[styles.squareLabel, selected && styles.squareLabelSelected]}>{content.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <FormInput
        label="Instructions (optional)"
        value={draft.instructions}
        onChangeText={(instructions) => onChange({ instructions })}
        maxLength={500}
      />
      <RadioGroup
        label="Who will pay"
        value={draft.payer ?? 'SENDER'}
        options={PAYERS}
        onChange={(payer) => onChange({ payer })}
      />
      <RadioGroup
        label="Payment"
        value={draft.paymentMethod ?? 'CASH'}
        options={PAYMENTS}
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

type RadioGroupProps<T extends string> = {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
};

function RadioGroup<T extends string>({ label, value, options, onChange }: RadioGroupProps<T>) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.radioOptions}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={styles.radioRow}
            >
              <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                {selected ? <View style={styles.radioInner} /> : null}
              </View>
              <Text style={styles.radioLabel}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
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
    marginBottom: spacing.sm,
  },
  squares: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  squarePress: {
    flex: 1,
  },
  square: {
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    padding: spacing.sm,
  },
  squareSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  squareLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  squareLabelSelected: {
    color: colors.primaryDark,
  },
  radioOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.xl,
    rowGap: spacing.xs,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    flexBasis: 140,
    gap: spacing.sm,
    minHeight: 44,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    fontSize: typography.body,
    color: colors.text,
  },
  note: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
});
