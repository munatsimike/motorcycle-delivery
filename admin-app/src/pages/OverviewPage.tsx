import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label } from '../lib/labels';
import type { DashboardSummary } from '../lib/types';
import { Empty, ErrorNote, Loading, textOf } from '../ui';

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
  const [showAllStatuses, setShowAllStatuses] = useState(false);

  if (summary.isLoading) {
    return <Loading label="Loading the overview" />;
  }
  if (summary.error) {
    return <ErrorNote>{textOf(summary.error)}</ErrorNote>;
  }
  const data = summary.data;
  if (!data) {
    return <ErrorNote>The overview could not be loaded.</ErrorNote>;
  }

  const deliveryBars = Object.entries(data.deliveries.byStatus).map(([status, value]) => ({ status, label: label(status), value }));
  const visibleBars = showAllStatuses ? deliveryBars : deliveryBars.filter((item) => item.value > 0);

  return (
    <div className="stack overview">
      <div className="page-head">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Overview</h1>
        </div>
        <button className="button-secondary" type="button" onClick={() => void summary.refetch()} disabled={summary.isFetching}>
          <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14"><path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M13.2 8A5.2 5.2 0 1 1 11.4 4M13.2 2.6V5h-2.4" /></svg>
          Refresh
        </button>
      </div>
      <section className="kpis overview-metrics" aria-label="Key figures">
        <Link className="kpi kpi-active" to="/deliveries"><span>Active deliveries</span><b>{data.deliveries.active}</b></Link>
        <Link className="kpi" to="/deliveries?status=DELIVERED"><span>Completed</span><b>{data.deliveries.completed}</b></Link>
        <Link className="kpi" to="/deliveries?status=CANCELLED"><span>Cancelled</span><b className="kpi-alert">{data.deliveries.cancelled}</b></Link>
        <Link className="kpi" to="/customers"><span>Customers</span><b>{data.customers.total}</b><small>{data.customers.individual} individual · {data.customers.business} business</small></Link>
      </section>
      <section className="overview-activity" aria-label="Recent activity">
        <article><span>Deliveries in the last 24 hours</span><b>{data.deliveries.last24Hours}</b></article>
        <Link to="/deliveries?status=FAILED"><span>Failed deliveries</span><b>{data.deliveries.failed}</b></Link>
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
            <>
              <div className="overview-status-head"><span>Status</span><span>Count</span></div>
              <ul className="bars">
                {visibleBars.map((item) => (
                  <li key={item.status}>
                    <span className={`status-name tone-${STATUS_TONE[item.status] ?? 'created'}`}>{item.label}</span>
                    <span className="track" aria-hidden="true"><span style={{ width: `${Math.round((item.value / Math.max(1, ...visibleBars.map((bar) => bar.value))) * 100)}%` }} /></span>
                    <b>{item.value}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <div className="overview-side">
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
          <section className="panel" aria-label="Pending reviews">
            <h2>Pending reviews</h2>
            <div className="overview-reviews">
              <Link to="/riders?approvalStatus=PENDING"><span>Rider approvals</span><b>{data.riders.pending}</b></Link>
              <Link to="/riders?verificationStatus=PENDING"><span>Licence reviews</span><b className="pill good">Open</b></Link>
              <Link to="/motorcycles?verificationStatus=PENDING"><span>Motorcycle reviews</span><b>{data.motorcycles.pending}</b></Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
