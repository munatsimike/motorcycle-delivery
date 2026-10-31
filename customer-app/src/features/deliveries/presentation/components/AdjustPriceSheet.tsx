import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheetModal from '../../../../components/BottomSheetModal';
import ErrorMessage from '../../../../components/ErrorMessage';
import PrimaryButton from '../../../../components/PrimaryButton';
import SecondaryButton from '../../../../components/SecondaryButton';
import { colors, radius, spacing, typography } from '../../../../theme';
import { customerOfferForBooking, offerFieldText } from '../../domain/deliveryQuote';

type AdjustPriceSheetProps = {
  visible: boolean;
  amount: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (offeredPrice: string) => void;
};

export default function AdjustPriceSheet({
  visible,
  amount,
  saving,
  error,
  onClose,
  onSave,
}: AdjustPriceSheetProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(amount);
  const [localError, setLocalError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (visible) {
      setText(amount);
      setLocalError(null);
    }
  }, [visible, amount]);

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  function save() {
    const submitted = customerOfferForBooking(text);
    if ('error' in submitted) {
      setLocalError(submitted.error);
      return;
    }
    onSave(submitted.offeredPrice);
  }

  return (
    <BottomSheetModal visible={visible} onClose={onClose} closeLabel="Close adjust price">
      <View style={[styles.sheet, { marginBottom: keyboardHeight > 0 ? keyboardHeight + spacing.xl : 0, paddingBottom: spacing.lg + (keyboardHeight > 0 ? 0 : insets.bottom) }]}>
        <Text style={styles.label}>Your offer (USD)</Text>
        <View style={styles.field}>
          <Text style={styles.currency}>USD</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(value) => {
              setText(offerFieldText(value));
              setLocalError(null);
            }}
            keyboardType="decimal-pad"
            inputMode="decimal"
            placeholder="0.00"
            placeholderTextColor={colors.textSecondary}
            maxLength={7}
            editable={!saving}
          />
        </View>
        <ErrorMessage message={localError ?? error} />
        <View style={styles.actions}>
          <View style={styles.action}>
            <SecondaryButton label="Cancel" disabled={saving} onPress={onClose} />
          </View>
          <View style={styles.action}>
            <PrimaryButton label="Save price" loading={saving} loadingLabel="Saving" onPress={save} />
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  label: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  currency: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  input: {
    flex: 1,
    fontSize: typography.body,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
