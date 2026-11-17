import { useEffect, useRef, useState } from 'react';
import { savedAddressLabel, skipsPlacesLookup, type SavedAddress } from './savedAddress';
import { ErrorMessage } from '../components/ErrorMessage';
import { deliveryErrorMessage } from '../deliveries/api';
import { clearStopLocation, type StopDraft } from './draft';
import {
  acceptSearchResult,
  confirmMapPin,
  createPlaceSessionToken,
  selectedAddressLabel,
  type PlaceSuggestion,
} from './places';

const SEARCH_DELAY_MS = 500;

export function AddressField({
  stop,
  onChange,
  onManualInput,
  locating = false,
  locateError = null,
  searchPlaces,
  resolvePlace,
  savedAddresses = [],
  onSelectSaved,
}: {
  stop: StopDraft;
  savedAddresses?: SavedAddress[];
  onSelectSaved?: (entry: SavedAddress) => void;
  onChange: (patch: Partial<StopDraft>) => void;
  onManualInput: () => void;
  locating?: boolean;
  locateError?: string | null;
  searchPlaces: (text: string, sessionToken: string) => Promise<PlaceSuggestion[]>;
  resolvePlace: (placeId: string, sessionToken: string) => Promise<{ label: string; latitude: string; longitude: string; suburb?: string; locality?: string }>;
}) {
  const [savedOpen, setSavedOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const typed = useRef(false);
  const sessionToken = useRef(createPlaceSessionToken());
  const requestId = useRef(0);
  const searchRef = useRef(searchPlaces);
  const resolveRef = useRef(resolvePlace);
  searchRef.current = searchPlaces;
  resolveRef.current = resolvePlace;

  useEffect(() => {
    const text = stop.address.trim();
    if (!typed.current || skipsPlacesLookup(stop)) {
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return undefined;
    }
    if (text.length < 3) {
      sessionToken.current = createPlaceSessionToken();
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return undefined;
    }
    const started = requestId.current + 1;
    requestId.current = started;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchRef.current(text, sessionToken.current)
        .then((next) => {
          if (!acceptSearchResult(started, requestId.current, next)) return;
          setSuggestions(next.slice(0, 10));
          setSearched(true);
          setSearchError(null);
        })
        .catch((caught: unknown) => {
          if (!acceptSearchResult(started, requestId.current, true)) return;
          setSuggestions([]);
          setSearched(false);
          setSearchError(deliveryErrorMessage(caught, 'Address suggestions are unavailable. You can type the address.'));
        })
        .finally(() => {
          if (acceptSearchResult(started, requestId.current, true)) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [stop.address, stop.latitude, stop.longitude]);

  async function selectSuggestion(suggestion: PlaceSuggestion) {
    setSearching(true);
    setSearchError(null);
    try {
      let chosen = suggestion;
      if (suggestion.placeId && !suggestion.latitude.trim()) {
        const resolved = await resolveRef.current(suggestion.placeId, suggestion.sessionToken || sessionToken.current);
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
        landmark: location.precision === 'exact' ? stop.landmark : stop.address.trim().slice(0, 200),
        latitude: location.latitude,
        longitude: location.longitude,
        approximate: location.precision !== 'exact',
        precision: location.precision,
        placeId: location.placeId,
        coordinateSource: 'GOOGLE_PLACES',
        resolvedAddress: '',
      });
    } catch (caught) {
      setSearchError(deliveryErrorMessage(caught, 'Address suggestions are unavailable. You can type the address.'));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="book-address">
      <label className="field">
        Address
        <span className="book-address-control">
          <input
            value={stop.address}
            maxLength={500}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            onChange={(event) => {
              if (event.target.value === stop.address) return;
              typed.current = true;
              if (event.target.value.trim()) onManualInput();
              onChange(clearStopLocation(event.target.value));
            }}
          />
          {onSelectSaved ? <button type="button" className="book-address-book-button" aria-label="Choose from Address Book" aria-expanded={savedOpen} onClick={() => setSavedOpen((value) => !value)}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M4 17h16"/><circle cx="12" cy="9" r="2"/><path d="M8.5 14c.3-1.7 1.5-2.5 3.5-2.5s3.2.8 3.5 2.5"/></svg></button> : null}
          {searching || locating ? <span className="book-address-spinner" role="status" aria-label={locating ? 'Finding your location' : 'Searching addresses'} /> : null}
        </span>
      </label>
      {savedOpen ? <div className="book-address-book-picker"><strong>Address Book</strong>{savedAddresses.length ? savedAddresses.map((entry) => <button key={entry.id} type="button" onClick={() => { onSelectSaved?.(entry); setSavedOpen(false); }}><strong>{savedAddressLabel(entry)}</strong><span>{entry.address}</span></button>) : <p>No saved addresses yet. Add one from More → Address Book.</p>}</div> : null}
      {locateError ? <p className="book-locate-error" role="status">{locateError}</p> : null}
      {searchError ? <ErrorMessage>{searchError}</ErrorMessage> : null}
      {searched && !searching && suggestions.length === 0 && !searchError ? (
        <p className="book-search-status" role="status">No matching addresses.</p>
      ) : null}
      {suggestions.length > 0 ? (
        <ul className="book-suggestions" role="listbox" aria-label="Address suggestions">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.placeId ?? suggestion.label}:${suggestion.latitude}`}>
              <button type="button" role="option" onClick={() => { void selectSuggestion(suggestion); }}>{suggestion.label}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
