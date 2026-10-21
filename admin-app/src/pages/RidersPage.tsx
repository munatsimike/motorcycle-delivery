import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { when } from '../lib/labels';
import type { Page, RiderRow } from '../lib/types';
import { Empty, ErrorNote, Loading, Pager, Status, textOf } from '../ui';

export function RidersPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1') || 1;
  const approvalStatus = params.get('approvalStatus') ?? '';
  const verificationStatus = params.get('verificationStatus') ?? '';
  const phone = params.get('phone') ?? '';
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (approvalStatus) query.set('approvalStatus', approvalStatus);
  if (verificationStatus) query.set('verificationStatus', verificationStatus);
  if (phone) query.set('phone', phone);

  const riders = useQuery({
    queryKey: ['riders', query.toString()],
    queryFn: () => adminApi.request<Page<RiderRow>>(`/admin/riders?${query.toString()}`),
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
          <h1>Riders</h1>
        </div>
      </div>
      <form className="filters" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const nextPhone = String(data.get('phone') ?? '').trim();
        if (nextPhone && !/^\+?[0-9]{7,15}$/.test(nextPhone)) {
          return;
        }
        update({ phone: nextPhone, approvalStatus: String(data.get('approvalStatus') ?? ''), verificationStatus: String(data.get('verificationStatus') ?? '') });
      }}>
        <label>Approval
          <select name="approvalStatus" defaultValue={approvalStatus}>
            <option value="">Any</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label>Licence
          <select name="verificationStatus" defaultValue={verificationStatus}>
            <option value="">Any</option>
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label>Phone
          <input name="phone" defaultValue={phone} placeholder="+2637…" />
        </label>
        <button className="button" type="submit">Apply</button>
      </form>
      {riders.isLoading ? <Loading label="Loading riders" /> : null}
      {riders.error ? <ErrorNote>{textOf(riders.error)}</ErrorNote> : null}
      {riders.data && riders.data.data.length === 0 ? <Empty>No riders match these filters.</Empty> : null}
      {riders.data && riders.data.data.length > 0 ? (
        <>
          <div className="table-scroll panel">
            <table>
              <thead><tr><th>Rider</th><th>Phone</th><th>Approval</th><th>Licence</th><th>Availability</th><th>Joined</th></tr></thead>
              <tbody>
                {riders.data.data.map((rider) => (
                  <tr key={rider.riderProfileId}>
                    <td><Link to={`/riders/${rider.riderProfileId}`}>{rider.fullName}</Link></td>
                    <td>{rider.phone}</td>
                    <td><Status value={rider.approvalStatus} /></td>
                    <td><Status value={rider.verificationStatus} /></td>
                    <td><Status value={rider.availability} /></td>
                    <td>{when(rider.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="cards">
            {riders.data.data.map((rider) => (
              <li key={rider.riderProfileId}><article>
                <Link to={`/riders/${rider.riderProfileId}`}><strong>{rider.fullName}</strong></Link>
                <span>{rider.phone}</span>
                <span><Status value={rider.approvalStatus} /> <Status value={rider.verificationStatus} /></span>
              </article></li>
            ))}
          </ul>
          <Pager page={riders.data.pagination.page} totalPages={riders.data.pagination.totalPages} onPage={(next) => update({ page: String(next) })} />
        </>
      ) : null}
    </div>
  );
}
