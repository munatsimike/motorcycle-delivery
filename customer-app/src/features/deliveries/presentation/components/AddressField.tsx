import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import FormInput from '../../../../components/FormInput';
import { colors, radius, spacing, typography } from '../../../../theme';
import { confirmMapPin, typedHouseNumber } from '../../domain/addressResolution';
import type { StopDraft } from '../../domain/bookingDraft';
import type { PlaceSuggestion } from '../../domain/placeSuggestion';

const SEARCH_DELAY_MS = 500;

type AddressFieldProps = {
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
  searchPlaces: (text: string) => Promise<PlaceSuggestion[]>;
  areaChoices?: PlaceSuggestion[];
  error?: string | null;
  showMatchNote?: boolean;
  editable?: boolean;
  onFocus?: () => void;
};

export default function AddressField({
  stop,
  onChange,
  searchPlaces,
  areaChoices = [],
  error = null,
  showMatchNote = true,
  editable = true,
  onFocus,
}: AddressFieldProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchPlacesRef = useRef(searchPlaces);
  searchPlacesRef.current = searchPlaces;

  useEffect(() => {
    const text = stop.address.trim();
    if (stop.latitude && stop.longitude) {
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return;
    }
    if (text.length < 3) {
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchPlacesRef.current(text)
        .then((next) => {
          if (!active) {
            return;
          }
          setSuggestions(next.slice(0, 10));
          setSearchError(null);
          setSearched(true);
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          setSuggestions([]);
          setSearched(false);
          setSearchError(
            error instanceof Error && error.message.trim()
              ? error.message
              : 'Address suggestions are unavailable. You can type the address.',
          );
        })
        .finally(() => {
          if (active) {
            setSearching(false);
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [stop.address, stop.latitude, stop.longitude]);

  return (
    <View style={styles.wrap}>
      <FormInput
        label="Address"
        value={stop.address}
        onChangeText={(address) => onChange({
          address,
          landmark: '',
          latitude: '',
          longitude: '',
          approximate: false,
          precision: null,
        })}
        textContentType="fullStreetAddress"
        maxLength={500}
        error={error}
        editable={editable}
        onFocus={onFocus}
      />
      {searching ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.status}>Searching addresses</Text>
        </View>
      ) : null}
      {searchError ? <Text style={styles.status}>{searchError}</Text> : null}
      {searched && !searching && suggestions.length === 0 && areaChoices.length === 0 && !searchError ? (
        <Text style={styles.status}>No matching addresses yet. You can keep what you typed and continue.</Text>
      ) : null}
      {areaChoices.length > 0 ? <Text style={styles.status}>Confirm a nearby area</Text> : null}
      {(areaChoices.length > 0 ? areaChoices : suggestions).map((suggestion) => (
        <Pressable
          key={`${suggestion.latitude},${suggestion.longitude},${suggestion.label}`}
          style={styles.suggestion}
          onPress={() => {
            setSuggestions([]);
            setSearched(false);
            const location = confirmMapPin(suggestion);
            onChange({
              address: location.label,
              landmark: location.precision === 'exact' ? stop.landmark : typedHouseNumber(stop.address, location.precision),
              latitude: location.latitude,
              longitude: location.longitude,
              approximate: location.precision !== 'exact',
              precision: location.precision,
            });
          }}
        >
          <Text style={styles.suggestionText}>{suggestion.label}</Text>
          {suggestion.exact ? null : <Text style={styles.area}>Area match</Text>}
        </Pressable>
      ))}
      {showMatchNote && (stop.precision === 'unverified' || stop.precision === 'area') ? (
        <Text style={styles.note}>
          No house number was found. The address you typed will be used as the number.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  status: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  suggestion: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  suggestionText: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.text,
  },
  area: {
    fontSize: typography.small,
    color: colors.primaryDark,
  },
  note: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.text,
  },
});
