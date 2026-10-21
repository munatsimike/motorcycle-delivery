import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { DELIVERY_STATUSES, label, when } from '../lib/labels';
import type { DeliveryRow, Page } from '../lib/types';
import { Empty, ErrorNote, Loading, Pager, Status, textOf } from '../ui';

export function DeliveriesPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1') || 1;
  const status = params.get('status') ?? '';
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (status) query.set('status', status);
  const deliveries = useQuery({
    queryKey: ['deliveries', query.toString()],
    queryFn: () => adminApi.request<Page<DeliveryRow>>(`/admin/deliveries?${query.toString()}`),
  });

  function update(next: Record<string, string>) {
    const values = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) values.set(key, value);
      else values.delete(key);
    }
    if (!('page' in next)) values.set('page', '1');
    setParams(values);
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Trips</p>
          <h1>Deliveries</h1>
        </div>
      </div>
      <p className="note">Delivery records are read only. Cancel and reassign are not available here.</p>
      <form className="filters" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        update({ status: String(data.get('status') ?? '') });
      }}>
        <label>Status
          <select name="status" defaultValue={status}>
            <option value="">Any</option>
            {DELIVERY_STATUSES.map((item) => <option key={item} value={item}>{label(item)}</option>)}
          </select>
        </label>
        <button className="button" type="submit">Apply</button>
      </form>
      {deliveries.isLoading ? <Loading label="Loading deliveries" /> : null}
      {deliveries.error ? <ErrorNote>{textOf(deliveries.error)}</ErrorNote> : null}
      {deliveries.data && deliveries.data.data.length === 0 ? <Empty>No deliveries match this status.</Empty> : null}
      {deliveries.data && deliveries.data.data.length > 0 ? (
        <>
          <div className="table-scroll panel">
            <table>
              <thead><tr><th>Trip</th><th>Status</th><th>Pickup</th><th>Drop-off</th><th>Price</th><th>Created</th></tr></thead>
              <tbody>
                {deliveries.data.data.map((delivery) => (
                  <tr key={delivery.deliveryId}>
                    <td><Link to={`/deliveries/${delivery.deliveryId}`}>{label(delivery.deliveryType)}</Link></td>
                    <td><Status value={delivery.status} /></td>
                    <td>{delivery.pickupAddress}</td>
                    <td>{delivery.dropoffAddress}</td>
                    <td>{delivery.currency} {delivery.price}</td>
                    <td>{when(delivery.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="cards">
            {deliveries.data.data.map((delivery) => (
              <li key={delivery.deliveryId}><article>
                <Link to={`/deliveries/${delivery.deliveryId}`}><strong>{label(delivery.deliveryType)}</strong></Link>
                <Status value={delivery.status} />
                <span>{delivery.pickupAddress}</span>
                <span>{delivery.currency} {delivery.price}</span>
              </article></li>
            ))}
          </ul>
          <Pager page={deliveries.data.pagination.page} totalPages={deliveries.data.pagination.totalPages} onPage={(next) => update({ page: String(next) })} />
        </>
      ) : null}
    </div>
  );
}
