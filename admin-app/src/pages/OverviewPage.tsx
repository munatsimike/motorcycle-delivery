import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label } from '../lib/labels';
import type { DashboardSummary, Page, RiderRow } from '../lib/types';
import { Empty, ErrorNote, Loading, textOf } from '../ui';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="overview-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const STATUS_TONE: Record<string, string> = {
  CREATED: 'created',
  SEARCHING: 'search',
  NO_RIDER_FOUND: 'warn',
  ASSIGNED: 'assigned',
  RIDER_ASSIGNED: 'assigned',
  COLLECTING: 'collect',
  COLLECTED: 'collect',
  OUT_FOR_DELIVERY: 'transit',
  ARRIVED_AT_PICKUP: 'collect',
  PICKED_UP: 'collect',
  IN_TRANSIT: 'transit',
  ARRIVED_AT_DROPOFF: 'transit',
  DELIVERED: 'done',
  CANCELLED: 'cancel',
  FAILED: 'fail',
};

export function OverviewPage() {
  const summary = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => adminApi.request<DashboardSummary>('/admin/dashboard/summary'),
  });
  const licenceReviews = useQuery({
    queryKey: ['dashboard-licence-reviews'],
    queryFn: () => adminApi.request<Page<RiderRow>>('/admin/riders?page=1&limit=1&verificationStatus=PENDING'),
  });
  const [showAllStatuses, setShowAllStatuses] = useState(false);

  if (summary.isLoading || licenceReviews.isLoading) {
    return <Loading label="Loading the overview" />;
  }
  if (summary.error) {
    return <ErrorNote>{textOf(summary.error)}</ErrorNote>;
  }
  if (licenceReviews.error) {
    return <ErrorNote>{textOf(licenceReviews.error)}</ErrorNote>;
  }
  const data = summary.data;
  const licenceCount = licenceReviews.data?.pagination.total;
  if (!data || licenceCount === undefined) {
    return <ErrorNote>The overview could not be loaded.</ErrorNote>;
  }

  const deliveryBars = Object.entries(data.deliveries.byStatus).map(([status, value]) => ({ status, label: label(status), value }));
  const visibleBars = showAllStatuses ? deliveryBars : deliveryBars.filter((item) => item.value > 0);
  const barMax = Math.max(1, ...visibleBars.map((item) => item.value));
  const refreshing = summary.isFetching || licenceReviews.isFetching;

  return (
    <div className="stack overview">
      <div className="page-head">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Overview</h1>
        </div>
        <button className="button-secondary" type="button" onClick={() => { void summary.refetch(); void licenceReviews.refetch(); }} disabled={refreshing}>
          <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14"><path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M13.2 8A5.2 5.2 0 1 1 11.4 4M13.2 2.6V5h-2.4" /></svg>
          Refresh
        </button>
      </div>
      <section className="overview-reviews" aria-label="Pending reviews">
        <ReviewLink to="/riders?approvalStatus=PENDING" title="Rider approvals" count={data.riders.pending} icon={<Icon><circle cx="12" cy="8" r="3" /><path d="M5 19c1.4-3 3.6-4.5 7-4.5s5.6 1.5 7 4.5" /></Icon>} />
        <ReviewLink to="/riders?verificationStatus=PENDING" title="Licence reviews" count={licenceCount} icon={<Icon><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="12" r="2" /><path d="M14 10h4M14 14h4" /></Icon>} />
        <ReviewLink to="/motorcycles?verificationStatus=PENDING" title="Motorcycle reviews" count={data.motorcycles.pending} icon={<Icon><circle cx="6.5" cy="16.5" r="2.2" /><circle cx="17.5" cy="16.5" r="2.2" /><path d="M6.5 16.5H11l1.5-5H16l1.5 5M8.5 11.5 11 16.5" /></Icon>} />
      </section>
      <section className="kpis overview-metrics" aria-label="Key figures">
        <Link className="kpi kpi-active" to="/deliveries">
          <span className="kpi-label"><Icon><path d="M3 8h11v7H3zM14 11h4l3 3v1h-7" /><circle cx="7" cy="17" r="1.4" /><circle cx="17" cy="17" r="1.4" /></Icon>Active deliveries</span>
          <b className="kpi-good">{data.deliveries.active}</b>
        </Link>
        <Link className="kpi" to="/deliveries?status=DELIVERED">
          <span className="kpi-label"><Icon><circle cx="12" cy="12" r="8" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></Icon>Completed</span>
          <b>{data.deliveries.completed}</b>
        </Link>
        <Link className="kpi" to="/deliveries?status=CANCELLED">
          <span className="kpi-label"><Icon><circle cx="12" cy="12" r="8" /><path d="m9 9 6 6M15 9l-6 6" /></Icon>Cancelled</span>
          <b className="kpi-alert">{data.deliveries.cancelled}</b>
        </Link>
        <Link className="kpi" to="/customers">
          <span className="kpi-label"><Icon><circle cx="9" cy="8" r="2.3" /><circle cx="16" cy="9" r="1.8" /><path d="M3.8 18c1.1-2.5 2.8-3.7 5.2-3.7s4.1 1.2 5.2 3.7M14 14.5c1.4.2 2.6.9 3.5 2.3" /></Icon>Customers</span>
          <b>{data.customers.total}</b>
          <small>{data.customers.individual} individual · {data.customers.business} business</small>
        </Link>
      </section>
      <section className="overview-activity" aria-label="Recent activity">
        <article><span><Icon><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l2.5 1.5" /></Icon>Deliveries in the last 24 hours</span><b>{data.deliveries.last24Hours}</b></article>
        <Link to="/deliveries?status=FAILED"><span><Icon><path d="M12 4 21 19H3L12 4z" /><path d="M12 10v4M12 16.5h.01" /></Icon>Failed deliveries</span><b>{data.deliveries.failed}</b></Link>
      </section>
      <div className="overview-board">
        <section className="panel">
          <div className="overview-panel-head">
            <h2>Deliveries by status</h2>
            <button className="button-secondary" type="button" aria-expanded={showAllStatuses} onClick={() => setShowAllStatuses((current) => !current)}>
              {showAllStatuses ? 'Show fewer' : 'Show all statuses'}
            </button>
          </div>
          {visibleBars.length === 0 ? <Empty>No deliveries are in a status yet.</Empty> : (
            <ul className="bars">
              {visibleBars.map((item) => (
                <li key={item.status}>
                  <span className={`status-name tone-${STATUS_TONE[item.status] ?? 'created'}`}>{item.label}</span>
                  <span className="track" aria-hidden="true"><span style={{ width: `${Math.round((item.value / barMax) * 100)}%` }} /></span>
                  <b>{item.value}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <div>
            <h2>Approved riders</h2>
            <p className="muted">{data.riders.approved} approved riders · {data.motorcycles.verified} verified motorcycles</p>
          </div>
          <ul className="overview-indicators">
            <li className="indicator-available"><span>Available</span><b>{data.riders.availability.available}</b></li>
            <li className="indicator-busy"><span>Busy</span><b>{data.riders.availability.busy}</b></li>
            <li className="indicator-offline"><span>Offline</span><b>{data.riders.availability.offline}</b></li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function ReviewLink({ to, title, count, icon }: { to: string; title: string; count: number; icon: ReactNode }) {
  return (
    <Link className={count > 0 ? 'review-attention' : undefined} to={to}>
      {icon}
      <span className="review-copy"><span>{title}</span><b>{count}</b></span>
      <Icon><path d="m9 6 6 6-6 6" /></Icon>
    </Link>
  );
}
