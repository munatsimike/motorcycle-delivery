import { useNavigate } from 'react-router-dom';
import { beginPageTransition } from '../motion/pageTransition';
import { DeliveryLabels } from '../components/DeliveryLabels';
import {
  deliveryCardAddress,
  deliveryCardStatusLabel,
  deliveryContentKind,
  deliveryStatusTone,
  showsViewBids,
  type CustomerDelivery,
} from './rules';

export function DeliveryCard({
  delivery,
}: {
  delivery: CustomerDelivery;
  cached?: boolean;
}) {
  const navigate = useNavigate();
  const kind = deliveryContentKind(delivery.parcelDescription);
  const offers = showsViewBids(delivery);
  const tone = deliveryStatusTone(delivery.status, offers);

  return (
    <article className="delivery-card">
      <button type="button" className="delivery-card-open" onClick={() => beginPageTransition(() => navigate(`/deliveries/${delivery.id}`))}>
        <span className="delivery-badge">
          <DeliveryLabels kind={kind} serviceClass={delivery.serviceClass} />
        </span>
        <span className="delivery-status" style={{ background: tone.background, color: tone.color }}>
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
    </article>
  );
}

function Pin({ dropoff }: { dropoff: boolean }) {
  return (
    <svg viewBox="4 1 16 22" aria-hidden="true" style={{ color: dropoff ? '#1A73E8' : '#169B62' }}>
      <path fill={dropoff ? '#1A73E8' : '#169B62'} d="M12 2.2a6.2 6.2 0 0 0-6.2 6.2c0 4.2 6.2 10.2 6.2 10.2s6.2-6 6.2-10.2A6.2 6.2 0 0 0 12 2.2z" /><text x="12" y="11.7" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#ffffff">{dropoff ? '2' : '1'}</text>
    </svg>
  );
}
