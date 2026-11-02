import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label, when } from '../lib/labels';
import type { CustomerRow, DeliveryRow, Page } from '../lib/types';
import { Empty, ErrorNote, Loading, Pager, Status, textOf } from '../ui';

export function CustomerPage() {
  const { customerAccountId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1') || 1;
  const customer = useQuery({
    queryKey: ['customer', customerAccountId],
    queryFn: () => adminApi.request<CustomerRow>(`/admin/customers/${customerAccountId}`),
    enabled: customerAccountId.length > 0,
  });
  const deliveries = useQuery({
    queryKey: ['customer-deliveries', customerAccountId, page],
    queryFn: () => adminApi.request<Page<DeliveryRow>>(`/admin/customers/${customerAccountId}/deliveries?page=${page}&limit=20`),
    enabled: customerAccountId.length > 0,
  });

  if (customer.isLoading) return <Loading label="Loading the customer" />;
  if (customer.error) return <ErrorNote>{textOf(customer.error)}</ErrorNote>;
  if (!customer.data) return <ErrorNote>Customer not found.</ErrorNote>;
  const person = customer.data;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Customer</p>
          <h1>{person.name}</h1>
          <p className="muted">{person.phone}</p>
        </div>
        <Link to="/customers">All customers</Link>
      </div>
      <section className="panel">
        <h2>Profile</h2>
        <div className="facts">
          <div><span>Account name</span><b>{person.fullName}</b></div>
          <div><span>Contact</span><b>{person.contactName ?? '—'}</b></div>
          <div><span>Phone</span><b>{person.phone}</b></div>
          <div><span>Kind</span><b><Status value={person.kind} /></b></div>
          <div><span>Account</span><b><Status value={person.accountStatus} /></b></div>
          <div><span>Address</span><b>{person.address}</b></div>
          <div><span>Joined</span><b>{when(person.createdAt)}</b></div>
          <div><span>Updated</span><b>{when(person.updatedAt)}</b></div>
        </div>
      </section>
      <section className="panel">
        <h2>Deliveries</h2>
        <p className="note">Delivery history is read only.</p>
        {deliveries.isLoading ? <Loading label="Loading deliveries" /> : null}
        {deliveries.error ? <ErrorNote>{textOf(deliveries.error)}</ErrorNote> : null}
        {deliveries.data && deliveries.data.data.length === 0 ? <Empty>This customer has no deliveries.</Empty> : null}
        {deliveries.data && deliveries.data.data.length > 0 ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Trip</th>
                    <th>Status</th>
                    <th>Pickup</th>
                    <th>Drop-off</th>
                    <th>Price</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.data.data.map((delivery) => (
                    <tr key={delivery.deliveryId}>
                      <td><Link to={`/deliveries/${delivery.deliveryId}`}>{label(delivery.deliveryType)}</Link></td>
                      <td><Status value={delivery.status} /></td>
                      <td>{delivery.pickupAddress}</td>
                      <td>{delivery.dropoffAddress}</td>
                      <td>{delivery.price ? `${delivery.currency} ${delivery.price}` : '—'}</td>
                      <td>{when(delivery.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={deliveries.data.pagination.page}
              totalPages={deliveries.data.pagination.totalPages}
              onPage={(next) => {
                const values = new URLSearchParams(params);
                values.set('page', String(next));
                setParams(values);
              }}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
