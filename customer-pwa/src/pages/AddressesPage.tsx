import { useEffect, useRef, useState } from 'react';
import addressBookImage from '../assets/address-book.png';
import { Link, useNavigate } from 'react-router-dom';
import { deleteSavedAddress, listSavedAddresses } from '../booking/addressApi';
import { AddressAvatar } from '../booking/AddressAvatar';
import { AddressSearchField, AddressSearchToggle } from '../booking/AddressSearchField';
import { AddressTypeFilter, type AddressTypeChoice } from '../booking/AddressTypeFilter';
import {
  emptyAddressList,
  filterSavedAddresses,
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
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [addressType, setAddressType] = useState<AddressTypeChoice>('ALL');
  const [fabCompact, setFabCompact] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const matchingAddresses = filterSavedAddresses(addresses, search).filter((entry) => addressType === 'ALL' || entry.label === addressType);
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

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    let last = node.scrollTop;
    const onScroll = () => {
      const next = node.scrollTop;
      if (next <= 8 || next < last - 4) setFabCompact(false);
      else if (next > last + 4) setFabCompact(true);
      last = next;
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [loading, addresses.length]);

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
        <h1>Address Book</h1>
      </header>
      {!loading && addresses.length > 0 ? (
        <div className={searchOpen ? 'address-book-toolbar is-searching' : 'address-book-toolbar'}>
          {searchOpen ? <AddressSearchField value={search} onChange={setSearch} onDismiss={() => { setSearchOpen(false); setSearch(''); }} /> : <AddressSearchToggle expanded={searchOpen} onToggle={() => setSearchOpen(true)} />}
          <AddressTypeFilter value={addressType} onChange={setAddressType} />
        </div>
      ) : null}
      <div className="book-scroll" ref={scrollRef}>
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
          {!loading && addresses.length > 0 && matchingAddresses.length === 0 ? <p className="address-search-empty">No matching addresses.</p> : null}
          {matchingAddresses.map((entry, index) => (
            <article key={entry.id} className={index === 0 ? 'address-card is-first' : 'address-card'}>
              <AddressAvatar name={entry.contactName} />
              <div className="address-card-heading">
                <h2>{entry.contactName}</h2>
                <span className={`address-type-badge ${entry.label === 'WORK' ? 'is-work' : 'is-home'}`}>{savedAddressLabel(entry)}</span>
              </div>
              <p className="address-card-location">{entry.address}</p>
              <div className="address-card-footer">
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
              </div>
            </article>
          ))}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </div>
      </div>
      {!loading && addresses.length > 0 && !searchOpen ? (
        <Link className={fabCompact ? 'address-book-fab is-compact' : 'address-book-fab'} to="/addresses/new" aria-label="Add address">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>Add</span>
        </Link>
      ) : null}
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
