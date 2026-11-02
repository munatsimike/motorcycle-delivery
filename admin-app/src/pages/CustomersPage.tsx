import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label, when } from '../lib/labels';
import type { CustomerRow, Page } from '../lib/types';
import { Empty, ErrorNote, Loading, Pager, Status, textOf } from '../ui';

export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1') || 1;
  const q = params.get('q') ?? '';
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (q) query.set('q', q);
  const customers = useQuery({
    queryKey: ['customers', query.toString()],
    queryFn: () => adminApi.request<Page<CustomerRow>>(`/admin/customers?${query.toString()}`),
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
          <p className="eyebrow">People</p>
          <h1>Customers</h1>
        </div>
      </div>
      <form className="filters" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        update({ q: String(data.get('q') ?? '').trim() });
      }}>
        <label>Name or phone
          <input name="q" defaultValue={q} placeholder="Name or phone" />
        </label>
        <button className="button" type="submit">Search</button>
      </form>
      {customers.isLoading ? <Loading label="Loading customers" /> : null}
      {customers.error ? <ErrorNote>{textOf(customers.error)}</ErrorNote> : null}
      {customers.data && customers.data.data.length === 0 ? <Empty>{q ? 'No customers match this search.' : 'No customers are registered.'}</Empty> : null}
      {customers.data && customers.data.data.length > 0 ? (
        <>
          <div className="table-scroll panel">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Account</th>
                  <th>Address</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {customers.data.data.map((customer) => (
                  <tr key={customer.customerAccountId}>
                    <td>
                      <Link to={`/customers/${customer.customerAccountId}`}><strong>{customer.name}</strong></Link>
                      {customer.contactName ? <span className="muted"> · {customer.contactName}</span> : null}
                    </td>
                    <td>{customer.phone}</td>
                    <td><Status value={customer.kind} /> <Status value={customer.accountStatus} /></td>
                    <td>{customer.address}</td>
                    <td>{when(customer.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="cards">
            {customers.data.data.map((customer) => (
              <li key={customer.customerAccountId}>
                <article>
                  <Link to={`/customers/${customer.customerAccountId}`}><strong>{customer.name}</strong></Link>
                  <span>{customer.phone}</span>
                  <span>{label(customer.kind)} · {customer.address}</span>
                </article>
              </li>
            ))}
          </ul>
          <Pager
            page={customers.data.pagination.page}
            totalPages={customers.data.pagination.totalPages}
            onPage={(next) => {
              const values = new URLSearchParams(params);
              values.set('page', String(next));
              setParams(values);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
