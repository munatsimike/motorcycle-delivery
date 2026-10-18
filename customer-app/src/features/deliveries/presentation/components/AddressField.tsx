import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import FormInput from '../../../../components/FormInput';
import { colors, radius, spacing, typography } from '../../../../theme';
import { confirmMapPin, typedHouseNumber } from '../../domain/addressResolution';
import type { StopDraft } from '../../domain/bookingDraft';
import { createPlaceSessionToken } from '../../domain/placeSession';
import { selectedAddressLabel, type PlaceSuggestion, type ResolvedPlace } from '../../domain/placeSuggestion';

const SEARCH_DELAY_MS = 500;

type AddressFieldProps = {
  stop: StopDraft;
  onChange: (patch: Partial<StopDraft>) => void;
  searchPlaces: (text: string, sessionToken: string) => Promise<PlaceSuggestion[]>;
  resolvePlace: (placeId: string, sessionToken: string) => Promise<ResolvedPlace>;
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
  resolvePlace,
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
  const resolvePlaceRef = useRef(resolvePlace);
  const sessionToken = useRef(createPlaceSessionToken());
  const typedByUser = useRef(false);
  searchPlacesRef.current = searchPlaces;
  resolvePlaceRef.current = resolvePlace;

  useEffect(() => {
    const text = stop.address.trim();
    if (!typedByUser.current || (stop.latitude && stop.longitude)) {
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return;
    }
    if (text.length < 3) {
      sessionToken.current = createPlaceSessionToken();
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchPlacesRef.current(text, sessionToken.current)
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

  async function selectSuggestion(suggestion: PlaceSuggestion) {
    setSearching(true);
    setSearchError(null);
    try {
      let chosen = suggestion;
      if (suggestion.placeId && !suggestion.latitude.trim()) {
        const token = suggestion.sessionToken || sessionToken.current;
        const resolved = await resolvePlaceRef.current(suggestion.placeId, token);
        chosen = {
          ...suggestion,
          label: selectedAddressLabel(suggestion.label, resolved),
          latitude: resolved.latitude,
          longitude: resolved.longitude,
        };
      }
      if (!chosen.latitude.trim() || !chosen.longitude.trim()) {
        throw new Error('Address suggestions are unavailable. You can type the address.');
      }
      const location = confirmMapPin(chosen);
      sessionToken.current = createPlaceSessionToken();
      setSuggestions([]);
      setSearched(false);
      onChange({
        address: location.label,
        landmark: location.precision === 'exact' ? stop.landmark : typedHouseNumber(stop.address, location.precision),
        latitude: location.latitude,
        longitude: location.longitude,
        approximate: location.precision !== 'exact',
        precision: location.precision,
        placeId: location.placeId,
        coordinateSource: location.provider === 'google_places' ? 'GOOGLE_PLACES' : 'DEVICE_GEOCODER',
      });
    } catch (caught) {
      setSearchError(
        caught instanceof Error && caught.message.trim()
          ? caught.message
          : 'Address suggestions are unavailable. You can type the address.',
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <FormInput
        label="Address"
        value={stop.address}
        onChangeText={(address) => {
          typedByUser.current = true;
          onChange({
            address,
            landmark: '',
            latitude: '',
            longitude: '',
            approximate: false,
            precision: null,
            placeId: null,
            coordinateSource: null,
          });
        }}
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
          key={`${suggestion.placeId ?? suggestion.latitude},${suggestion.label}`}
          style={styles.suggestion}
          onPress={() => {
            void selectSuggestion(suggestion);
          }}
        >
          <Text style={styles.suggestionText}>{suggestion.label}</Text>
          {suggestion.exact ? null : <Text style={styles.area}>Area match</Text>}
        </Pressable>
      ))}
      {suggestions.length > 0 || areaChoices.length > 0 ? (
        <Text style={styles.attribution}>Google Maps</Text>
      ) : null}
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
    backgroundColor: '#FFF1E0',
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
  attribution: {
    fontSize: typography.small,
    color: colors.textSecondary,
  },
  note: {
    fontSize: typography.caption,
    lineHeight: 20,
    color: colors.text,
  },
});
