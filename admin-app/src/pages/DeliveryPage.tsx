import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label, when } from '../lib/labels';
import type { DeliveryDetail } from '../lib/types';
import { ErrorNote, Loading, Status, textOf } from '../ui';

export function DeliveryPage() {
  const { deliveryId = '' } = useParams();
  const delivery = useQuery({
    queryKey: ['delivery', deliveryId],
    queryFn: () => adminApi.request<DeliveryDetail>(`/admin/deliveries/${deliveryId}`),
  });
  if (delivery.isLoading) return <Loading label="Loading the delivery" />;
  if (delivery.error) return <ErrorNote>{textOf(delivery.error)}</ErrorNote>;
  if (!delivery.data) return <ErrorNote>Delivery not found.</ErrorNote>;
  const trip = delivery.data;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Delivery</p>
          <h1>{label(trip.deliveryType)}</h1>
        </div>
        <Link to="/deliveries">All deliveries</Link>
      </div>
      <p className="note">This record is read only.</p>
      <section className="kpis">
        <article className="kpi"><span>Status</span><Status value={trip.status} /></article>
        <article className="kpi"><span>Price</span><b>{trip.currency} {trip.price}</b></article>
        <article className="kpi"><span>Suggested</span><b>{trip.suggestedPrice ? `${trip.currency} ${trip.suggestedPrice}` : '—'}</b></article>
        <article className="kpi"><span>Distance</span><b>{trip.distanceMeters ?? '—'}{trip.distanceMeters === null ? '' : ' m'}</b></article>
      </section>
      <section className="panel">
        <h2>Stops</h2>
        <p><strong>Pickup.</strong> {trip.pickupAddress}</p>
        <p><strong>Drop-off.</strong> {trip.dropoffAddress}</p>
        <p className="muted">Parcel {trip.parcelSize ?? '—'} · payer {trip.payer ? label(trip.payer) : '—'} · payment {label(trip.paymentMethod)} · pricing version {trip.pricingVersion ?? '—'}</p>
      </section>
      <section className="panel">
        <h2>Status timeline</h2>
        {trip.statusTimeline.length === 0 ? <p className="note">No status events.</p> : (
          <ol className="stack">
            {trip.statusTimeline.map((event) => (
              <li key={event.id}>{when(event.occurredAt)} · {event.previousStatus ? `${label(event.previousStatus)} → ` : ''}{label(event.newStatus)} · {label(event.actorType)}</li>
            ))}
          </ol>
        )}
      </section>
      <section className="panel">
        <h2>Assignments</h2>
        {trip.assignments.length === 0 ? <p className="note">No assignments.</p> : (
          <ul className="cards" style={{ display: 'grid' }}>
            {trip.assignments.map((assignment) => (
              <li key={assignment.id}><article>
                <Status value={assignment.status} />
                <span>Rider {assignment.riderProfileId}</span>
                <span>Motorcycle {assignment.motorcycleId}</span>
                {assignment.releaseReason ? <span>Release {label(assignment.releaseReason)} · {when(assignment.releasedAt)}</span> : null}
                <span>Offered until {when(assignment.offerExpiresAt)}</span>
              </article></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
