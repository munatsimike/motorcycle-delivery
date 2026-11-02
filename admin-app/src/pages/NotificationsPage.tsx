import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { NOTICE_EVENT_TYPES, NOTICE_STATUSES, label, when } from '../lib/labels';
import type { NoticeRow, Page } from '../lib/types';
import { Empty, ErrorNote, Loading, Pager, Status, textOf } from '../ui';

export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1') || 1;
  const status = params.get('status') ?? '';
  const eventType = params.get('eventType') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (status) query.set('status', status);
  if (eventType) query.set('eventType', eventType);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const notices = useQuery({
    queryKey: ['notifications', query.toString()],
    queryFn: () => adminApi.request<Page<NoticeRow>>(`/admin/notifications?${query.toString()}`),
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
          <p className="eyebrow">Monitoring</p>
          <h1>Notifications</h1>
        </div>
      </div>
      <p className="note">Outbox records are read only. A failed notice can have no stored error.</p>
      <form className="filters" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        update({
          status: String(data.get('status') ?? ''),
          eventType: String(data.get('eventType') ?? ''),
          from: String(data.get('from') ?? ''),
          to: String(data.get('to') ?? ''),
        });
      }}>
        <label>Status
          <select name="status" defaultValue={status}>
            <option value="">Any</option>
            {NOTICE_STATUSES.map((item) => <option key={item} value={item}>{label(item)}</option>)}
          </select>
        </label>
        <label>Event
          <select name="eventType" defaultValue={eventType}>
            <option value="">Any</option>
            {NOTICE_EVENT_TYPES.map((item) => <option key={item} value={item}>{label(item)}</option>)}
          </select>
        </label>
        <label>From
          <input name="from" type="date" defaultValue={from} />
        </label>
        <label>To
          <input name="to" type="date" defaultValue={to} />
        </label>
        <button className="button" type="submit">Apply</button>
      </form>
      {notices.isLoading ? <Loading label="Loading notifications" /> : null}
      {notices.error ? <ErrorNote>{textOf(notices.error)}</ErrorNote> : null}
      {notices.data && notices.data.data.length === 0 ? <Empty>No notifications match these filters.</Empty> : null}
      {notices.data && notices.data.data.length > 0 ? (
        <>
          <div className="table-scroll panel">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Error</th>
                  <th>Created</th>
                  <th>Attempted</th>
                  <th>Sent</th>
                  <th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {notices.data.data.map((notice) => (
                  <tr key={notice.id}>
                    <td>{label(notice.eventType)}</td>
                    <td><Status value={notice.status} /></td>
                    <td>{notice.attemptCount}</td>
                    <td>{failureText(notice)}</td>
                    <td>{when(notice.createdAt)}</td>
                    <td>{when(notice.lastAttemptAt)}</td>
                    <td>{when(notice.sentAt)}</td>
                    <td>{notice.deliveryId ? <Link to={`/deliveries/${notice.deliveryId}`}>View delivery</Link> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={notices.data.pagination.page}
            totalPages={notices.data.pagination.totalPages}
            onPage={(next) => update({ page: String(next), status, eventType, from, to })}
          />
        </>
      ) : null}
    </div>
  );
}

function failureText(notice: NoticeRow): string {
  if (notice.lastFailure) return label(notice.lastFailure);
  if (notice.status === 'FAILED') return 'No stored error';
  return '—';
}
