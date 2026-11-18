import { useEffect, useState } from 'react';
import addressBookImage from '../assets/address-book.png';
import { Link, useNavigate } from 'react-router-dom';
import { deleteSavedAddress, listSavedAddresses } from '../booking/addressApi';
import {
  emptyAddressList,
  readSavedAddresses,
  savedAddressLabel,
  withoutSavedAddress,
  type SavedAddress,
} from '../booking/savedAddress';
import { isSessionRejection } from '../auth/contracts';
import { rememberReturnPath } from '../auth/returnPath';
import { useSession } from '../auth/sessionContext';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loading } from '../components/Loading';
import { deliveryErrorMessage } from '../deliveries/api';
import { beginPageTransition } from '../motion/pageTransition';
import { motionClass, usePresence } from '../motion/usePresence';

export function AddressesPage() {
  const navigate = useNavigate();
  const { accessToken, signOut } = useSession();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<SavedAddress | null>(null);
  const dialog = usePresence(pendingDelete !== null, 150);

  useEffect(() => {
    let active = true;
    void accessToken().then(async (token) => {
      if (!active) return;
      if (!token) {
        rememberReturnPath('/addresses');
        navigate('/sign-in', { replace: true, state: { from: '/addresses' } });
        return;
      }
      try {
        const rows = readSavedAddresses(await listSavedAddresses(token));
        if (active) setAddresses(rows);
      } catch (caught) {
        if (!active) return;
        if (isSessionRejection(caught)) {
          rememberReturnPath('/addresses');
          await signOut();
          navigate('/sign-in', { replace: true, state: { from: '/addresses' } });
          return;
        }
        setError(deliveryErrorMessage(caught, 'Saved addresses are unavailable.'));
      } finally {
        if (active) setLoading(false);
      }
    }).catch(() => {
      if (active) {
        setError('Saved addresses are unavailable.');
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [accessToken, navigate, signOut]);

  async function remove(entry: SavedAddress) {
    setPendingDelete(null);
    setError(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error('Saved addresses are unavailable.');
      await deleteSavedAddress(token, entry.id);
      setAddresses((current) => withoutSavedAddress(current, entry.id));
    } catch (caught) {
      setError(deliveryErrorMessage(caught, 'The address could not be deleted.'));
    }
  }

  return (
    <section className="book address-book-page page-stage is-entering">
      <header className="book-header">
        <button type="button" className="book-back" aria-label="Back" onClick={() => beginPageTransition(() => navigate('/profile'))}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor" />
          </svg>
        </button>
      </header>
      <div className="book-scroll">
        <div className="book-column address-book">
          {loading ? <Loading label="Loading addresses" /> : null}
          {!loading && emptyAddressList(addresses) ? (
            <div className="address-empty">
              <img src={addressBookImage} alt="" />
              <Link className="address-add" to="/addresses/new">Add address</Link>
              <h2>No address saved yet</h2>
              <p>Saved addresses will appear here.</p>
            </div>
          ) : null}
          {addresses.map((entry) => (
            <article key={entry.id} className="address-card">
              <div className="address-card-heading">
                <span className={`address-type-badge ${entry.label === 'WORK' ? 'is-work' : 'is-home'}`}>{savedAddressLabel(entry)}</span>
                <h2>{entry.contactName}</h2>
              </div>
              <p className="address-card-location">{entry.address}</p>
              <p className="address-card-phone">{entry.contactPhone}</p>
              <div className="address-card-actions">
                <Link className="address-icon-action" to={`/addresses/${entry.id}`} aria-label={`Edit ${savedAddressLabel(entry)} address`} title="Edit address">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z" />
                  </svg>
                </Link>
                <button className="address-icon-action address-icon-delete" type="button" aria-label={`Delete ${savedAddressLabel(entry)} address`} title="Delete address" onClick={() => setPendingDelete(entry)}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v7m4-7v7" />
                  </svg>
                </button>
              </div>
            </article>
          ))}
          {!loading && addresses.length > 0 ? <Link className="address-add" to="/addresses/new">Add address</Link> : null}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </div>
      </div>
      {dialog.mounted && pendingDelete ? (
        <div className={motionClass('profile-dialog', 'dialog', dialog.visible)} role="dialog" aria-modal="true" aria-labelledby="delete-address-title">
          <div className="profile-dialog-card">
            <h2 id="delete-address-title">Delete {savedAddressLabel(pendingDelete)}?</h2>
            <p>This removes it from My addresses. Past deliveries stay unchanged.</p>
            <div>
              <button type="button" onClick={() => setPendingDelete(null)}>Keep address</button>
              <button type="button" onClick={() => { void remove(pendingDelete); }}>Delete address</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
