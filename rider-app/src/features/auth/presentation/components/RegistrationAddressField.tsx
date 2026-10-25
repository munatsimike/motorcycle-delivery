import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import FormInput from '../../../../components/FormInput';
import { apiGet } from '../../../../services/api/apiClient';
import { colors, radius, spacing, typography } from '../../../../theme';

const SEARCH_DELAY_MS = 500;

type Suggestion = {
  label: string;
  placeId: string;
};

type RegistrationAddressFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
};

export default function RegistrationAddressField({
  value,
  onChangeText,
  editable = true,
}: RegistrationAddressFieldProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const sessionToken = useRef(createSessionToken());
  const typedByUser = useRef(false);
  const requestId = useRef(0);

  useEffect(() => {
    const text = value.trim();
    if (!typedByUser.current) {
      return;
    }
    if (text.length < 3) {
      sessionToken.current = createSessionToken();
      setSuggestions([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const current = requestId.current + 1;
    requestId.current = current;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchPlaces(text, sessionToken.current)
        .then((next) => {
          if (requestId.current !== current) {
            return;
          }
          setSuggestions(next);
          setSearchError(null);
        })
        .catch((caught: unknown) => {
          if (requestId.current !== current) {
            return;
          }
          setSuggestions([]);
          setSearchError(caught instanceof Error && caught.message.trim()
            ? caught.message
            : 'Address suggestions are unavailable. You can type the address.');
        })
        .finally(() => {
          if (requestId.current === current) {
            setSearching(false);
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [value]);

  async function selectSuggestion(suggestion: Suggestion) {
    const current = requestId.current + 1;
    requestId.current = current;
    setSearching(true);
    setSearchError(null);
    try {
      const resolved = await resolvePlace(suggestion.placeId, sessionToken.current);
      if (requestId.current !== current) {
        return;
      }
      typedByUser.current = false;
      sessionToken.current = createSessionToken();
      setSuggestions([]);
      onChangeText(resolved || suggestion.label);
    } catch (caught) {
      if (requestId.current !== current) {
        return;
      }
      typedByUser.current = false;
      setSuggestions([]);
      onChangeText(suggestion.label);
      setSearchError(caught instanceof Error && caught.message.trim()
        ? caught.message
        : 'Address suggestions are unavailable. You can type the address.');
    } finally {
      if (requestId.current === current) {
        setSearching(false);
      }
    }
  }

  return (
    <View style={styles.wrap}>
      <FormInput
        label="Address"
        value={value}
        onChangeText={(next) => {
          typedByUser.current = true;
          onChangeText(next);
        }}
        placeholder="Street address"
        maxLength={500}
        editable={editable}
      />
      {searching ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.status}>Searching addresses</Text>
        </View>
      ) : null}
      {searchError ? <Text style={styles.status}>{searchError}</Text> : null}
      {suggestions.map((suggestion) => (
        <Pressable
          key={suggestion.placeId}
          style={styles.suggestion}
          onPress={() => {
            void selectSuggestion(suggestion);
          }}
        >
          <Text style={styles.suggestionText}>{suggestion.label}</Text>
        </Pressable>
      ))}
      {suggestions.length > 0 ? <Text style={styles.attribution}>Google Maps</Text> : null}
    </View>
  );
}

async function searchPlaces(text: string, sessionToken: string): Promise<Suggestion[]> {
  const params = new URLSearchParams();
  params.set('text', text);
  params.set('sessionToken', sessionToken);
  const body = await apiGet<unknown>(`/auth/places?${params.toString()}`);
  if (!isRecord(body) || !Array.isArray(body.suggestions)) {
    throw new Error('Address suggestions are unavailable. You can type the address.');
  }
  const suggestions: Suggestion[] = [];
  for (const item of body.suggestions) {
    if (!isRecord(item) || typeof item.label !== 'string' || typeof item.placeId !== 'string') {
      continue;
    }
    const label = item.label.trim();
    const placeId = item.placeId.trim();
    if (!label || !placeId) {
      continue;
    }
    suggestions.push({ label, placeId });
    if (suggestions.length === 10) {
      break;
    }
  }
  return suggestions;
}

async function resolvePlace(placeId: string, sessionToken: string): Promise<string> {
  const params = new URLSearchParams();
  params.set('placeId', placeId);
  params.set('sessionToken', sessionToken);
  const body = await apiGet<unknown>(`/auth/places/detail?${params.toString()}`);
  if (!isRecord(body) || typeof body.label !== 'string' || !body.label.trim()) {
    throw new Error('Address suggestions are unavailable. You can type the address.');
  }
  return body.label.trim();
}

function createSessionToken(): string {
  const bytes = new Uint8Array(16);
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    marginBottom: spacing.md,
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
  },
  suggestionText: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.text,
  },
  attribution: {
    fontSize: typography.small,
    color: colors.textSecondary,
  },
});
