import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label, when } from '../lib/labels';
import type { CustomerRow, Page } from '../lib/types';
import { Empty, ErrorNote, Loading, Pager, Status, textOf } from '../ui';

export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1') || 1;
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  const customers = useQuery({
    queryKey: ['customers', query.toString()],
    queryFn: () => adminApi.request<Page<CustomerRow>>(`/admin/customers?${query.toString()}`),
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">People</p>
          <h1>Customers</h1>
        </div>
      </div>
      {customers.isLoading ? <Loading label="Loading customers" /> : null}
      {customers.error ? <ErrorNote>{textOf(customers.error)}</ErrorNote> : null}
      {customers.data && customers.data.data.length === 0 ? <Empty>No customers are registered.</Empty> : null}
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
                      <strong>{customer.name}</strong>
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
                  <strong>{customer.name}</strong>
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
