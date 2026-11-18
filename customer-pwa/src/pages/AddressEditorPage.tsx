import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AddressField } from '../booking/AddressField';
import { createSavedAddress, listSavedAddresses, updateSavedAddress } from '../booking/addressApi';
import { resolvePlace, searchPlaces } from '../booking/api';
import { bookingPhoneDisplay, bookingPhoneStored, deliveryContactPhone, emptyStop, type StopDraft } from '../booking/draft';
import { readSavedAddress, readSavedAddresses, type SavedAddressLabel } from '../booking/savedAddress';
import { isSessionRejection } from '../auth/contracts';
import { rememberReturnPath } from '../auth/returnPath';
import { useSession } from '../auth/sessionContext';
import { Button } from '../components/Button';
import { ButtonSpinner } from '../components/ButtonSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loading } from '../components/Loading';
import { ZimbabwePhoneField } from '../components/ZimbabwePhoneField';
import { deliveryErrorMessage } from '../deliveries/api';
import { beginPageTransition } from '../motion/pageTransition';

const LABELS: SavedAddressLabel[] = ['HOME', 'WORK'];

export function AddressEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = Boolean(id);
  const { accessToken, signOut } = useSession();
  const [label, setLabel] = useState<SavedAddressLabel | null>(editing ? null : 'HOME');
  const [stop, setStop] = useState<StopDraft>(emptyStop);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let active = true;
    void accessToken().then(async (token) => {
      if (!active) return;
      if (!token) {
        rememberReturnPath(`/addresses/${id}`);
        navigate('/sign-in', { replace: true, state: { from: `/addresses/${id}` } });
        return;
      }
      try {
        const rows = readSavedAddresses(await listSavedAddresses(token));
        const entry = rows.find((row) => row.id === id);
        if (!entry) throw new Error('Saved address not found.');
        if (!active) return;
        const full = readSavedAddress(entry);
        if (!full) throw new Error('Saved address not found.');
        setLabel(full.label === 'HOME' || full.label === 'WORK' ? full.label : null);
        setStop({
          ...emptyStop(),
          address: full.address,
          resolvedAddress: full.address,
          latitude: full.latitude,
          longitude: full.longitude,
          contactName: full.contactName,
          contactPhone: full.contactPhone,
          placeId: full.placeId,
          coordinateSource: full.coordinateSource,
          precision: 'exact',
        });
      } catch (caught) {
        if (!active) return;
        if (isSessionRejection(caught)) {
          await signOut();
          navigate('/sign-in', { replace: true });
          return;
        }
        setError(deliveryErrorMessage(caught, 'Saved address not found.'));
      } finally {
        if (active) setLoading(false);
      }
    }).catch(() => {
      if (active) {
        setError('Saved address not found.');
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [accessToken, id, navigate, signOut]);

  async function save() {
    const issue = formIssue(label, stop);
    if (issue || !label) {
      setError(issue ?? 'Choose Home or Work');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      label,
      customLabel: null,
      address: stop.resolvedAddress.trim() || stop.address.trim(),
      latitude: stop.latitude,
      longitude: stop.longitude,
      placeId: stop.coordinateSource === 'GOOGLE_PLACES' ? stop.placeId : null,
      coordinateSource: stop.coordinateSource === 'GOOGLE_PLACES' ? 'GOOGLE_PLACES' : 'DEVICE_GEOCODER',
      contactName: stop.contactName,
      contactPhone: deliveryContactPhone(stop.contactPhone),
    };
    try {
      const token = await accessToken();
      if (!token) throw new Error('The address could not be saved.');
      if (id) await updateSavedAddress(token, id, body);
      else await createSavedAddress(token, body);
      beginPageTransition(() => navigate('/addresses', { replace: true }));
    } catch (caught) {
      setError(deliveryErrorMessage(caught, 'The address could not be saved.'));
      setSaving(false);
    }
  }

  return (
    <section className="book address-editor-page page-stage is-entering">
      <header className="book-header">
        <button type="button" className="book-back" aria-label="Back" onClick={() => beginPageTransition(() => navigate('/addresses'))}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor" />
          </svg>
        </button>
        <h1>{editing ? 'Edit address' : 'Add address'}</h1>
      </header>
      <div className="book-scroll">
        <div className="book-column address-book">
          {loading ? <Loading label="Loading address" /> : (
            <>
              <fieldset className="book-block">
                <legend>Label</legend>
                <div className="book-choice">
                  {LABELS.map((option) => (
                    <button key={option} type="button" aria-pressed={label === option} className={label === option ? 'is-selected' : undefined} onClick={() => setLabel(option)}>
                      {option === 'HOME' ? 'Home' : 'Work'}
                    </button>
                  ))}
                </div>
              </fieldset>
              <AddressField
                stop={stop}
                placeholder="Search for an address"
                onChange={(patch) => setStop((current) => ({ ...current, ...patch }))}
                onManualInput={() => undefined}
                searchPlaces={(text, sessionToken) => searchWithToken(accessToken, text, sessionToken)}
                resolvePlace={(placeId, sessionToken) => resolveWithToken(accessToken, placeId, sessionToken)}
              />
              <label className="field">
                Contact name
                <input value={stop.contactName} maxLength={200} autoComplete="name" onChange={(event) => setStop((current) => ({ ...current, contactName: event.target.value }))} />
              </label>
              <ZimbabwePhoneField
                id="saved-address-phone"
                label="Contact phone"
                value={bookingPhoneDisplay(stop.contactPhone)}
                autoComplete="tel"
                onChange={(local) => setStop((current) => ({ ...current, contactPhone: bookingPhoneStored(local) }))}
              />
              {error ? <ErrorMessage>{error}</ErrorMessage> : null}
              <Button type="button" disabled={saving} onClick={() => { void save(); }}>{saving ? <><ButtonSpinner />Saving…</> : 'Save address'}</Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function formIssue(label: SavedAddressLabel | null, stop: StopDraft): string | null {
  if (label !== 'HOME' && label !== 'WORK') return 'Choose Home or Work';
  if (!stop.address.trim()) return 'Enter the address';
  if (stop.coordinateSource !== 'GOOGLE_PLACES' && stop.coordinateSource !== 'DEVICE_GEOCODER') return 'Choose the address';
  if (!stop.latitude.trim() || !stop.longitude.trim()) return 'Choose the address';
  if (!stop.contactName.trim()) return 'Enter the contact name';
  if (!deliveryContactPhone(stop.contactPhone)) return 'Enter the contact phone';
  return null;
}

async function searchWithToken(accessToken: () => Promise<string | null>, text: string, sessionToken: string) {
  const token = await accessToken();
  if (!token) throw new Error('Address suggestions are unavailable. You can type the address.');
  return searchPlaces(token, text, null, sessionToken);
}

async function resolveWithToken(accessToken: () => Promise<string | null>, placeId: string, sessionToken: string) {
  const token = await accessToken();
  if (!token) throw new Error('Address suggestions are unavailable. You can type the address.');
  return resolvePlace(token, placeId, sessionToken);
}
