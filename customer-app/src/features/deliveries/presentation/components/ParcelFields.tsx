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
import DeadlineField from './DeadlineField';

type ParcelFieldsProps = {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
  marketplace?: boolean;
};

type IconName = ComponentProps<typeof MaterialDesignIcons>['name'];

const INSTRUCTION_LIMIT = 200;
const NOTE_BLUE = '#3B82F6';
const NOTE_BLUE_SURFACE = '#E8F2FC';

const CONTENTS: { label: string; description: string; icon: IconName }[] = [
  { label: 'Parcel', description: 'Parcel', icon: 'package-variant' },
  { label: 'Document', description: 'Document', icon: 'file-document' },
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

const CLASSES: { value: ServiceClass; label: string }[] = [
  { value: 'EXPRESS', label: 'Express' },
  { value: 'FLEXIBLE', label: 'Flexible' },
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
    if (!marketplace && !draft.paymentMethod) {
      patch.paymentMethod = 'CASH';
    }
    if (Object.keys(patch).length > 0) {
      onChange(patch);
    }
  }, [draft.description, draft.payer, draft.paymentMethod, draft.size, marketplace, onChange, selectedDescription]);

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
                  {selected ? (
                    <View style={styles.check}>
                      <MaterialDesignIcons name="check" size={12} color={colors.textInverse} />
                    </View>
                  ) : null}
                  <View style={[styles.squareIcon, selected && styles.squareIconSelected]}>
                    <MaterialDesignIcons
                      name={content.icon}
                      size={22}
                      color={selected ? colors.primary : colors.text}
                    />
                  </View>
                  <Text style={[styles.squareLabel, selected && styles.squareLabelSelected]}>{content.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.block}>
        <Text style={styles.title}>Instructions (optional)</Text>
        <Text style={styles.subtitle}>Add any special instructions for the rider.</Text>
        <View style={[styles.instructions, instructionsFocus.style]}>
          <View style={styles.instructionsRow}>
            <MaterialDesignIcons name="pencil" size={18} color={colors.textSecondary} style={styles.pencil} />
            <TextInput
              style={styles.instructionsInput}
              value={draft.instructions}
              onChangeText={(instructions) => onChange({ instructions: instructions.slice(0, INSTRUCTION_LIMIT) })}
              placeholder="E.g. fragile item, call me on arrival, leave at reception, etc."
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
        <>
          <View style={styles.block}>
            <Text style={styles.title}>Service</Text>
            <View style={styles.radioRow}>
              {CLASSES.map((option) => {
                const selected = draft.serviceClass === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => onChange({ serviceClass: option.value })}
                    style={styles.radioOption}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text style={styles.radioLabel}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <DeadlineField value={draft.deliverBy} onChange={(deliverBy) => onChange({ deliverBy })} />
        </>
      ) : null}

      {marketplace ? null : (
      <>
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

      <View style={styles.block}>
        <Text style={styles.title}>Payment method</Text>
        <View style={styles.radioRow}>
          {PAYMENTS.map((option) => {
            const selected = (draft.paymentMethod ?? 'CASH') === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => onChange({ paymentMethod: option.value })}
                style={styles.radioOption}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <MaterialDesignIcons
                  name={option.icon}
                  size={18}
                  color={selected ? colors.primary : colors.textSecondary}
                />
                <Text style={styles.radioLabel}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.note}>
          <MaterialDesignIcons name="information" size={18} color={NOTE_BLUE} />
          <Text style={styles.noteText}>
            Payment is not collected in the app. The rider is paid using the method you choose.
          </Text>
        </View>
      </View>
      </>
      )}
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
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  squareSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  check: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  squareIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  squareIconSelected: {
    backgroundColor: colors.background,
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
  instructions: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.sm,
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
    minHeight: 48,
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
  radioOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
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
    borderRadius: radius.md,
    backgroundColor: NOTE_BLUE_SURFACE,
    padding: spacing.md,
  },
  noteText: {
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.text,
  },
});
