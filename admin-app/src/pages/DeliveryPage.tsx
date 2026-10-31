import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { agreedBidAmount, commissionPercent, commissionStateLabel, commissionStateTime } from '../lib/deliveryDetail';
import { label, when } from '../lib/labels';
import type { AdminAcceptance, DeliveryDetail } from '../lib/types';
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
        <article className="kpi"><span>Price</span><b>{trip.price ? `${trip.currency} ${trip.price}` : '—'}</b></article>
        <article className="kpi"><span>Suggested</span><b>{trip.suggestedPrice ? `${trip.currency} ${trip.suggestedPrice}` : '—'}</b></article>
        <article className="kpi"><span>Distance</span><b>{trip.distanceMeters ?? '—'}{trip.distanceMeters === null ? '' : ' m'}</b></article>
      </section>
      <section className="panel">
        <h2>Stops</h2>
        <p><strong>Pickup.</strong> {trip.pickupAddress}</p>
        <p><strong>Drop-off.</strong> {trip.dropoffAddress}</p>
        <p className="muted">Parcel {trip.parcelSize ?? '—'} · payer {trip.payer ? label(trip.payer) : '—'} · payment {trip.paymentMethod ? label(trip.paymentMethod) : '—'} · pricing version {trip.pricingVersion ?? '—'}</p>
      </section>
      {trip.serviceClass ? <MarketplaceRecord delivery={trip} /> : null}
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
                <span>Rider {assignment.riderName || assignment.riderProfileId}</span>
                <span>Motorcycle {assignment.motorcycleId ?? '—'}</span>
                {assignment.releaseReason ? <span>Release {label(assignment.releaseReason)} · {when(assignment.releasedAt)}</span> : null}
                {assignment.offerExpiresAt ? <span>Offered until {when(assignment.offerExpiresAt)}</span> : null}
              </article></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MarketplaceRecord({ delivery }: { delivery: DeliveryDetail }) {
  const agreed = agreedBidAmount(delivery);
  const rider = delivery.assignments.find((item) => item.id === delivery.activeAssignment?.id) ?? null;
  return (
    <>
      <section className="panel">
        <h2>Marketplace booking</h2>
        <p><strong>Service.</strong> {label(delivery.serviceClass ?? '')}</p>
        {delivery.deliverBy ? <p><strong>Deliver by.</strong> {when(delivery.deliverBy)}</p> : null}
        <p><strong>Status.</strong> {label(delivery.status)}</p>
        <p><strong>Suggested price.</strong> {delivery.suggestedPrice ? `${delivery.currency} ${delivery.suggestedPrice}` : '—'}</p>
        <p><strong>Agreed price.</strong> {agreed ? `${delivery.currency} ${agreed}` : '—'}</p>
        <p><strong>Rider.</strong> {rider ? rider.riderName || rider.riderProfileId : '—'}</p>
      </section>
      <section className="panel">
        <h2>Bids</h2>
        {delivery.bids.length === 0 ? <p className="note">No bids have been submitted.</p> : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Rider</th><th>Amount</th><th>Status</th><th>Submitted</th><th>Closed</th></tr>
              </thead>
              <tbody>
                {delivery.bids.map((bid) => (
                  <tr key={bid.id}>
                    <td>{bid.riderName || bid.riderProfileId}</td>
                    <td>{bid.currency} {bid.amount}</td>
                    <td>{bid.accepted ? 'Accepted bid ' : null}<Status value={bid.status} /></td>
                    <td>{when(bid.createdAt)}</td>
                    <td>{when(bid.closedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Acceptance and commission</h2>
        {delivery.acceptances.length === 0 ? <p className="note">No bid has been accepted.</p> : (
          <ul className="cards" style={{ display: 'grid' }}>
            {delivery.acceptances.map((acceptance) => (
              <li key={acceptance.assignmentId}><Acceptance acceptance={acceptance} /></li>
            ))}
          </ul>
        )}
        {delivery.unmatchedReservations.length > 0 ? (
          <p className="note">A commission reservation is recorded without an acceptance.</p>
        ) : null}
      </section>
    </>
  );
}

function Acceptance({ acceptance }: { acceptance: AdminAcceptance }) {
  const recordedAt = commissionStateTime(acceptance);
  return (
    <article>
      <Status value={acceptance.assignmentStatus} />
      <span>Rider {acceptance.riderName || acceptance.riderProfileId}</span>
      <span>Accepted bid {acceptance.bidAmount ? `${acceptance.currency} ${acceptance.bidAmount}` : '—'}</span>
      <span>Accepted {when(acceptance.acceptedAt)}</span>
      <span>Commission rate {commissionPercent(acceptance.basisPoints)}</span>
      <span>Commission {acceptance.commissionAmount ? `${acceptance.currency} ${acceptance.commissionAmount}` : '—'}</span>
      <span>{commissionStateLabel(acceptance.commissionState)}{recordedAt ? ` · ${when(recordedAt)}` : ''}</span>
      {acceptance.reservation ? <span>Reservation {acceptance.currency} {acceptance.reservation.amount}</span> : null}
    </article>
  );
}
