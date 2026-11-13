import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorMessage } from '../components/ErrorMessage';
import { deliveryErrorMessage } from './api';
import {
  contentLabel,
  deliveryCanSearchAgain,
  deliveryCardAddress,
  deliveryCardStatusLabel,
  deliveryContentKind,
  deliveryStatusTone,
  showsViewBids,
  type CustomerDelivery,
} from './rules';

export function DeliveryCard({
  delivery,
  cached = false,
  onSearchAgain,
}: {
  delivery: CustomerDelivery;
  cached?: boolean;
  onSearchAgain: (deliveryId: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const kind = deliveryContentKind(delivery.parcelDescription);
  const offers = showsViewBids(delivery);
  const tone = deliveryStatusTone(delivery.status, offers);
  const canSearch = deliveryCanSearchAgain(delivery);
  const pulse = !cached && delivery.serviceClass != null && delivery.status === 'CREATED';

  async function searchAgain() {
    if (searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      await onSearchAgain(delivery.id);
    } catch (caught) {
      setSearchError(deliveryErrorMessage(caught, 'Rider search could not be started.'));
    } finally {
      setSearching(false);
    }
  }

  return (
    <article className="delivery-card">
      <button type="button" className="delivery-card-open" onClick={() => navigate(`/deliveries/${delivery.id}`)}>
        <span className="delivery-badge">
          <ContentIcon kind={kind} />
          <span>{contentLabel(kind)}</span>
          {delivery.serviceClass ? <ServiceBadge serviceClass={delivery.serviceClass} /> : null}
        </span>
        <span className="delivery-status" style={{ background: tone.background, color: tone.color }} data-pulse={pulse ? 'true' : 'false'}>
          {deliveryCardStatusLabel(delivery)}
        </span>
        <span className="delivery-stop">
          <Pin dropoff={false} />
          <span>{deliveryCardAddress(delivery.pickupAddress)}</span>
        </span>
        <span className="delivery-stop">
          <Pin dropoff />
          <span>{deliveryCardAddress(delivery.dropoffAddress)}</span>
        </span>
      </button>
      {canSearch ? (
        <button type="button" className="delivery-search" disabled={searching} onClick={() => void searchAgain()}>
          Search again
        </button>
      ) : null}
      {searchError ? <ErrorMessage>{searchError}</ErrorMessage> : null}
    </article>
  );
}

function ServiceBadge({ serviceClass }: { serviceClass: 'EXPRESS' | 'FLEXIBLE' }) {
  const urgent = serviceClass === 'EXPRESS';
  return (
    <span className="delivery-class">
      {urgent ? 'Urgent' : 'Flexible'}
    </span>
  );
}

function ContentIcon({ kind }: { kind: 'parcel' | 'document' | 'food' }) {
  if (kind === 'food') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v8a2 2 0 0 1-2 2H5v8h2v-6h1a4 4 0 0 0 4-4V3H8Zm8 0c-1.2 2.2-2 4.4-2 7a4 4 0 0 0 2 3.4V21h2v-7.2A6.8 6.8 0 0 0 20 10c0-2.6-1.2-5-4-7Z" /></svg>
    );
  }
  if (kind === 'document') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7V3Zm7 1.5V9h4.5L14 4.5ZM9 12h6v1.5H9V12Zm0 3h6v1.5H9V15Z" /></svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16l-1.2 11.2A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.8L4 8Zm3.2-3h9.6l.8 3H6.4l.8-3Z" /></svg>
  );
}

function Pin({ dropoff }: { dropoff: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ color: dropoff ? '#1A73E8' : '#169B62' }}>
      <path d="M12 2.8a6.2 6.2 0 0 0-6.2 6.2c0 4.7 6.2 12.2 6.2 12.2s6.2-7.5 6.2-12.2A6.2 6.2 0 0 0 12 2.8Zm0 8.4a2.2 2.2 0 1 1 2.2-2.2A2.2 2.2 0 0 1 12 11.2Z" />
    </svg>
  );
}
