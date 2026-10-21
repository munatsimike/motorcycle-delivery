import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label } from '../lib/labels';
import type { DashboardSummary } from '../lib/types';
import { Bars, ErrorNote, Loading, textOf } from '../ui';

export function OverviewPage() {
  const summary = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => adminApi.request<DashboardSummary>('/admin/dashboard/summary'),
  });

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

  const deliveryBars = Object.entries(data.deliveries.byStatus).map(([status, value]) => ({ label: label(status), value }));
  const availability = [
    { label: 'Available', value: data.riders.availability.available },
    { label: 'Busy', value: data.riders.availability.busy },
    { label: 'Offline', value: data.riders.availability.offline },
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Overview</h1>
        </div>
        <button className="button-secondary" type="button" onClick={() => void summary.refetch()} disabled={summary.isFetching}>Refresh</button>
      </div>
      <section className="kpis" aria-label="Key figures">
        <Link className="kpi" to="/deliveries"><span>Active deliveries</span><b>{data.deliveries.active}</b></Link>
        <Link className="kpi" to="/deliveries?status=DELIVERED"><span>Completed</span><b>{data.deliveries.completed}</b></Link>
        <Link className="kpi" to="/deliveries?status=CANCELLED"><span>Cancelled</span><b>{data.deliveries.cancelled}</b></Link>
        <article className="kpi"><span>Deliveries, 24 hours</span><b>{data.deliveries.last24Hours}</b></article>
        <Link className="kpi" to="/riders?approvalStatus=PENDING"><span>Riders awaiting approval</span><b>{data.riders.pending}</b></Link>
        <Link className="kpi" to="/riders?verificationStatus=PENDING"><span>Licence review queue</span><b>Open</b></Link>
        <Link className="kpi" to="/motorcycles?verificationStatus=PENDING"><span>Motorcycles to review</span><b>{data.motorcycles.pending}</b></Link>
        <article className="kpi"><span>Customers</span><b>{data.customers.total}</b><span>{data.customers.individual} individual · {data.customers.business} business</span></article>
      </section>
      <div className="split">
        <section className="panel">
          <h2>Deliveries by status</h2>
          <Bars items={deliveryBars} />
        </section>
        <section className="panel">
          <h2>Approved riders</h2>
          <Bars items={availability} />
          <p className="muted">{data.riders.approved} approved · {data.riders.suspended} suspended · {data.riders.rejected} rejected</p>
          <p className="muted">{data.motorcycles.verified} verified motorcycles · {data.motorcycles.rejected} rejected · {data.motorcycles.revoked} revoked</p>
        </section>
      </div>
    </div>
  );
}
