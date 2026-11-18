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
              <p className="address-label">{savedAddressLabel(entry)}</p>
              <h2>{entry.address}</h2>
              <p>{entry.contactName}</p>
              <p>{entry.contactPhone}</p>
              <div>
                <Link to={`/addresses/${entry.id}`}>Edit</Link>
                <button type="button" onClick={() => setPendingDelete(entry)}>Delete</button>
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
