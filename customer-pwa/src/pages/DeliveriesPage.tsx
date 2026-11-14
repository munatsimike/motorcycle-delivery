import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import parcelBox from '../assets/parcel-box.png';
import { ErrorMessage } from '../components/ErrorMessage';
import { useSession } from '../auth/sessionContext';
import { DeliveryCard } from '../deliveries/DeliveryCard';
import { searchForRider } from '../deliveries/api';
import {
  ACTIVE_LIST_STATUSES,
  HISTORY_LIST_STATUSES,
  deliveryContentKind,
  sortDeliveries,
  type DeliveryContentKind,
  type DeliveryGroup,
  type DeliveryListSort,
} from '../deliveries/rules';
import { useDeliveries } from '../deliveries/useDeliveries';
import { motionClass, usePresence } from '../motion/usePresence';

const SORTS: { id: DeliveryListSort; label: string; shortLabel: string }[] = [
  { id: 'oldest', label: 'Date: oldest to newest', shortLabel: 'Date' },
  { id: 'newest', label: 'Date: newest to oldest', shortLabel: 'Date' },
  { id: 'shortest', label: 'Distance: shortest to longest', shortLabel: 'Distance' },
  { id: 'longest', label: 'Distance: longest to shortest', shortLabel: 'Distance' },
  { id: 'lowest', label: 'Price: lowest to highest', shortLabel: 'Price' },
  { id: 'highest', label: 'Price: highest to lowest', shortLabel: 'Price' },
];

const FILTERS: { id: DeliveryContentKind | 'all'; label: string; menu: string }[] = [
  { id: 'all', label: 'All', menu: 'All' },
  { id: 'parcel', label: 'Parcel', menu: 'Parcel' },
  { id: 'document', label: 'Doc', menu: 'Document' },
  { id: 'food', label: 'Food', menu: 'Food' },
];

export function DeliveriesPage() {
  const { accessToken } = useSession();
  const [group, setGroup] = useState<DeliveryGroup>('active');
  const [contentKind, setContentKind] = useState<DeliveryContentKind | null>(null);
  const [sort, setSort] = useState<DeliveryListSort>('newest');
  const [sheet, setSheet] = useState<'filter' | 'sort' | null>(null);
  const sheetSnapshot = useRef(sheet);
  if (sheet) sheetSnapshot.current = sheet;
  const shownSheet = sheet ?? sheetSnapshot.current;
  const sheetMotion = usePresence(sheet !== null, 220);
  const active = useDeliveries(ACTIVE_LIST_STATUSES);
  const history = useDeliveries(HISTORY_LIST_STATUSES);
  const selected = group === 'active' ? active : history;
  const visible = contentKind
    ? selected.deliveries.filter((delivery) => deliveryContentKind(delivery.parcelDescription) === contentKind)
    : selected.deliveries;
  const ordered = sortDeliveries(visible, sort);
  const selectedSort = SORTS.find((item) => item.id === sort) ?? SORTS[1];
  const selectedFilter = FILTERS.find((item) => item.id === (contentKind ?? 'all')) ?? FILTERS[0];
  const emptyTitle = contentKind === 'food'
    ? 'No food deliveries'
    : contentKind === 'document'
      ? 'No documents'
      : contentKind === 'parcel'
        ? 'No parcels'
        : group === 'active'
          ? 'No active deliveries'
          : 'No past deliveries';
  const emptyBody = contentKind && selected.deliveries.length > 0
    ? 'None of these deliveries match this filter.'
    : 'All your deliveries will appear here once you book.';
  const pull = useRef({ y: 0, top: 0 });

  async function searchAgain(deliveryId: string) {
    const token = await accessToken();
    if (!token) throw new Error('Sign in again.');
    await searchForRider(token, deliveryId);
    selected.reload();
  }

  return (
    <div className="deliveries">
      <div className="deliveries-header">
        <div className="deliveries-switch" role="tablist" aria-label="Delivery groups">
          {(['active', 'history'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={group === id} className={group === id ? 'is-selected' : undefined} onClick={() => setGroup(id)}>
              {id === 'active' ? 'Active' : 'History'}
            </button>
          ))}
        </div>
        <div className="deliveries-tools">
          <button type="button" className="deliveries-tool" aria-label={`Filter deliveries, ${selectedFilter.menu}`} onClick={() => setSheet('filter')}>
            <FilterIcon />
            <span>{selectedFilter.menu}</span>
            <ChevronDownIcon />
          </button>
          <button type="button" className="deliveries-tool" aria-label={`Sort deliveries, ${selectedSort.label}`} onClick={() => setSheet('sort')}>
            <SortIcon />
            <span>{selectedSort.shortLabel}</span>
            <ChevronDownIcon />
          </button>
        </div>
      </div>
      <div
        className="deliveries-scroll"
        onTouchStart={(event) => {
          const scroller = event.currentTarget;
          pull.current = { y: event.touches[0]?.clientY ?? 0, top: scroller.scrollTop };
        }}
        onTouchEnd={(event) => {
          const dy = (event.changedTouches[0]?.clientY ?? 0) - pull.current.y;
          if (pull.current.top <= 0 && dy > 72 && !selected.isRefreshing) selected.refresh();
        }}
      >
        {selected.offlineNote ? <p className="deliveries-saved" role="status">{selected.offlineNote}</p> : null}
        {selected.error ? (
          <div className="deliveries-error">
            <ErrorMessage>{selected.error}</ErrorMessage>
            <button type="button" className="deliveries-retry" onClick={selected.reload}>Try again</button>
          </div>
        ) : null}
        {!selected.error && !(selected.isLoading && selected.deliveries.length === 0) && ordered.length === 0 ? (
          <div className="deliveries-empty">
            <img src={parcelBox} alt="" />
            <h1>{emptyTitle}</h1>
            <p>{emptyBody}</p>
          </div>
        ) : null}
        <div className="deliveries-list">
          {ordered.map((delivery) => (
            <DeliveryCard key={delivery.id} delivery={delivery} cached={Boolean(selected.offlineNote)} onSearchAgain={searchAgain} />
          ))}
        </div>
        {selected.hasMore ? (
          <button type="button" className="deliveries-more" disabled={selected.isLoading || selected.isLoadingMore} onClick={selected.loadMore}>
            {selected.isLoadingMore ? 'Loading' : 'Load more'}
          </button>
        ) : null}
      </div>
      <Link className="deliveries-fab" to="/book" aria-label="Send a parcel">+</Link>
      {sheetMotion.mounted && shownSheet ? (
        <div className={motionClass('deliveries-sheet-backdrop', 'sheet', sheetMotion.visible)} onClick={() => setSheet(null)}>
          <div className="deliveries-sheet" role="dialog" aria-label={shownSheet === 'filter' ? 'Filter' : 'Sort by'} onClick={(event) => event.stopPropagation()}>
            <h2>{shownSheet === 'filter' ? 'Filter' : 'Sort by'}</h2>
            <div role="radiogroup">
              {shownSheet === 'filter' ? FILTERS.map((item) => {
                const selectedItem = item.id === 'all' ? contentKind === null : item.id === contentKind;
                return (
                  <button key={item.id} type="button" role="radio" aria-checked={selectedItem} className={selectedItem ? 'is-selected' : undefined} onClick={() => {
                    setContentKind(item.id === 'all' || selectedItem ? null : item.id);
                    setSheet(null);
                  }}>
                    <span>{item.menu}</span>
                    <span className="deliveries-radio" />
                  </button>
                );
              }) : SORTS.map((item) => (
                <button key={item.id} type="button" role="radio" aria-checked={item.id === sort} className={item.id === sort ? 'is-selected' : undefined} onClick={() => {
                  setSort(item.id);
                  setSheet(null);
                }}>
                  <span>{item.label}</span>
                  <span className="deliveries-radio" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 13h12v-2H6v2Zm-2-4h16V7H4v2Zm4 8h8v-2H8v2Z" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3ZM9 3 5 7h3v7h2V7h3L9 3Z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="deliveries-chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.41 8.58 12 13.17l4.59-4.59L18 10l-6 6-6-6 1.41-1.42Z" />
    </svg>
  );
}
