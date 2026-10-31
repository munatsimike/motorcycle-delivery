import { type ComponentProps, useEffect } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';

import { useInputFocus } from '../../../../components/useInputFocus';
import { colors, radius, spacing, typography } from '../../../../theme';
import type {
  BookingDraft,
  DeliveryPayer,
  ParcelSize,
  PaymentMethod,
  ServiceClass,
} from '../../domain/bookingDraft';
type ParcelFieldsProps = {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
  marketplace?: boolean;
};

type IconName = ComponentProps<typeof MaterialDesignIcons>['name'];

const INSTRUCTION_LIMIT = 200;

const CONTENTS: { label: string; description: string; icon: IconName }[] = [
  { label: 'Parcel', description: 'Parcel', icon: 'package-variant-closed' },
  { label: 'Document', description: 'Document', icon: 'file-document-outline' },
  { label: 'Food', description: 'Food', icon: 'silverware-fork-knife' },
];

const PAYERS: { value: DeliveryPayer; label: string; detail: string }[] = [
  { value: 'SENDER', label: 'Sender', detail: 'I will pay' },
  { value: 'RECIPIENT', label: 'Recipient', detail: 'They will pay' },
];

const PAYMENTS: { value: PaymentMethod; label: string; icon: IconName }[] = [
  { value: 'CASH', label: 'Cash', icon: 'cash' },
  { value: 'ECOCASH', label: 'EcoCash', icon: 'cellphone' },
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

const CLASSES: { value: ServiceClass; label: string; icon: IconName }[] = [
  { value: 'FLEXIBLE', label: 'Flexible', icon: 'message-text-outline' },
  { value: 'EXPRESS', label: 'Urgent', icon: 'flash-outline' },
];

export default function ParcelFields({ draft, onChange, marketplace = false }: ParcelFieldsProps) {
  const selectedDescription = CONTENTS.some((content) => content.description === draft.description)
    ? draft.description
    : 'Parcel';

  const instructionsFocus = useInputFocus();

  useEffect(() => {
    const patch: Partial<BookingDraft> = {};
    if (draft.description !== selectedDescription) {
      patch.description = selectedDescription;
    }
    if (!draft.size) {
      patch.size = 'SMALL';
    }
    if (!marketplace && !draft.payer) {
      patch.payer = 'SENDER';
    }
    if (!draft.paymentMethod) {
      patch.paymentMethod = 'CASH';
    }
    if (marketplace && draft.serviceClass !== 'EXPRESS' && draft.serviceClass !== 'FLEXIBLE') {
      patch.serviceClass = 'FLEXIBLE';
    }
    if (!marketplace && draft.serviceClass != null) {
      patch.serviceClass = null;
    }
    if (Object.keys(patch).length > 0) {
      onChange(patch);
    }
  }, [draft.description, draft.payer, draft.paymentMethod, draft.serviceClass, draft.size, marketplace, onChange, selectedDescription]);

  return (
    <View style={styles.fields}>
      <View style={styles.block}>
        <Text style={styles.title}>What are you sending?</Text>
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
                    size={18}
                    color={selected ? colors.primary : colors.text}
                  />
                  <Text style={[styles.squareLabel, selected && styles.squareLabelSelected]}>{content.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.block}>
        <Text style={styles.title}>Description (optional)</Text>
        <Text style={styles.subtitle}>Describe what you are sending.</Text>
        <View style={[styles.instructions, instructionsFocus.style]}>
          <View style={styles.instructionsRow}>
            <MaterialDesignIcons name="pencil-outline" size={18} color={colors.textSecondary} style={styles.pencil} />
            <TextInput
              style={styles.instructionsInput}
              value={draft.instructions}
              onChangeText={(instructions) => onChange({ instructions: instructions.slice(0, INSTRUCTION_LIMIT) })}
              placeholder="E.g. motor spares, clothes"
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={INSTRUCTION_LIMIT}
              textAlignVertical="top"
              onFocus={instructionsFocus.onFocus}
              onBlur={instructionsFocus.onBlur}
            />
          </View>
          <Text style={styles.counter}>{draft.instructions.length}/{INSTRUCTION_LIMIT}</Text>
        </View>
      </View>

      {marketplace ? (
        <View style={styles.block}>
          <Text style={styles.title}>Delivery type</Text>
          <View style={styles.optionRow}>
            {CLASSES.map((option) => {
              const selected = draft.serviceClass === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => onChange({ serviceClass: option.value })}
                  style={styles.deliveryRadio}
                >
                  <View style={[styles.radio, selected && styles.deliveryRadioSelected]}>
                    {selected ? <View style={styles.deliveryRadioDot} /> : null}
                  </View>
                  <MaterialDesignIcons
                    name={option.icon}
                    size={16}
                    color={selected ? colors.primary : colors.textSecondary}
                    style={optionIconStyle(option.icon)}
                  />
                  <Text style={styles.deliveryRadioLabel}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {marketplace ? null : (
      <View style={styles.block}>
        <Text style={styles.title}>Who will pay?</Text>
        <View style={styles.radioRow}>
          {PAYERS.map((option) => {
            const selected = (draft.payer ?? 'SENDER') === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => onChange({ payer: option.value })}
                style={styles.radioOption}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <View style={styles.radioCopy}>
                  <Text style={styles.radioLabel}>{option.label}</Text>
                  <Text style={styles.radioDetail}>{option.detail}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
      )}

      <View style={styles.block}>
        <Text style={styles.title}>Payment method</Text>
        <View style={styles.optionRow}>
          {PAYMENTS.map((option) => {
            const selected = (draft.paymentMethod ?? 'CASH') === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => onChange({ paymentMethod: option.value })}
                style={styles.deliveryRadio}
              >
                <View style={[styles.radio, selected && styles.deliveryRadioSelected]}>
                  {selected ? <View style={styles.deliveryRadioDot} /> : null}
                </View>
                <MaterialDesignIcons
                  name={option.icon}
                  size={16}
                  color={selected ? colors.primary : colors.textSecondary}
                  style={optionIconStyle(option.icon)}
                />
                <Text style={styles.deliveryRadioLabel}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.note}>
          <MaterialDesignIcons name="information-outline" size={18} color={colors.primary} />
          <Text style={styles.noteText}>
            Payment is made directly to the rider.
          </Text>
        </View>
      </View>
    </View>
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

function optionIconStyle(icon: IconName) {
  if (icon === 'flash-outline') {
    return [styles.optionIcon, styles.urgentIcon];
  }
  if (icon === 'cash') {
    return [styles.optionIcon, styles.cashIcon];
  }
  return styles.optionIcon;
}

const styles = StyleSheet.create({
  fields: {
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  block: {
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  squares: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  squarePress: {
    flex: 1,
  },
  square: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  squareSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  squareLabel: {
    fontSize: typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  squareLabelSelected: {
    color: colors.primary,
  },
  instructions: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  instructionsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  pencil: {
    marginTop: 2,
  },
  instructionsInput: {
    flex: 1,
    minHeight: 22,
    padding: 0,
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.text,
  },
  counter: {
    alignSelf: 'flex-end',
    fontSize: typography.small,
    color: colors.textSecondary,
  },
  radioRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  radioOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
    borderRadius: 5,
  },
  radioDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  deliveryRadio: {
    flex: 1,
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 32,
  },
  optionIcon: {
    width: 16,
    height: 16,
    lineHeight: 16,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  urgentIcon: {
    // flash-outline leaves 3px more empty space before the label than message-text-outline
    transform: [{ translateX: 3 }],
  },
  cashIcon: {
    // the cash mark sits 1px below the center used by the other icons
    transform: [{ translateY: -1 }],
  },
  deliveryRadioLabel: {
    fontSize: typography.caption,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  deliveryRadioSelected: {
    borderColor: colors.primary,
    borderRadius: 5,
  },
  deliveryRadioDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  radioCopy: {
    flex: 1,
  },
  radioLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  radioDetail: {
    fontSize: typography.small,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
  },
  noteText: {
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.text,
  },
});
