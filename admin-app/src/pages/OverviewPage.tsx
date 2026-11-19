import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label } from '../lib/labels';
import type { DashboardSummary } from '../lib/types';
import { Bars, Empty, ErrorNote, Loading, textOf } from '../ui';

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
        <button className="button-secondary" type="button" onClick={() => void summary.refetch()} disabled={summary.isFetching}>Refresh</button>
      </div>
      <section className="kpis overview-metrics" aria-label="Key figures">
        <Link className="kpi" to="/deliveries"><span>Active deliveries</span><b>{data.deliveries.active}</b></Link>
        <Link className="kpi" to="/deliveries?status=DELIVERED"><span>Completed</span><b>{data.deliveries.completed}</b></Link>
        <Link className="kpi" to="/deliveries?status=CANCELLED"><span>Cancelled</span><b>{data.deliveries.cancelled}</b></Link>
        <Link className="kpi" to="/customers"><span>Customers</span><b>{data.customers.total}</b><span>{data.customers.individual} individual · {data.customers.business} business</span></Link>
      </section>
      <section className="overview-activity" aria-label="Recent activity">
        <article><span>Deliveries, 24 hours</span><b>{data.deliveries.last24Hours}</b></article>
        <Link to="/deliveries?status=FAILED"><span>Failed</span><b>{data.deliveries.failed}</b></Link>
      </section>
      <section className="panel" aria-label="Pending reviews">
        <h2>Pending reviews</h2>
        <div className="overview-reviews">
          <Link to="/riders?approvalStatus=PENDING"><span>Rider approvals</span><b>{data.riders.pending}</b></Link>
          <Link to="/riders?verificationStatus=PENDING"><span>Licence reviews</span><b>Open</b></Link>
          <Link to="/motorcycles?verificationStatus=PENDING"><span>Motorcycle reviews</span><b>{data.motorcycles.pending}</b></Link>
        </div>
      </section>
      <div className="overview-board">
        <section className="panel">
          <div className="overview-panel-head">
            <h2>Deliveries by status</h2>
            <button className="button-secondary" type="button" aria-expanded={showAllStatuses} onClick={() => setShowAllStatuses((current) => !current)}>
              {showAllStatuses ? 'Show fewer' : 'Show all statuses'}
            </button>
          </div>
          {visibleBars.length === 0 ? <Empty>No deliveries are in a status yet.</Empty> : <Bars items={visibleBars} />}
        </section>
        <section className="panel">
          <h2>Approved riders</h2>
          <ul className="overview-indicators">
            <li><span>Available</span><b>{data.riders.availability.available}</b></li>
            <li><span>Busy</span><b>{data.riders.availability.busy}</b></li>
            <li><span>Offline</span><b>{data.riders.availability.offline}</b></li>
          </ul>
          <p className="muted">{data.riders.approved} approved riders · {data.motorcycles.verified} verified motorcycles</p>
        </section>
      </div>
    </div>
  );
}
