import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/client';
import { label } from '../lib/labels';
import type { MotorcycleRow, Page } from '../lib/types';
import { Dialog, Empty, ErrorNote, Loading, Pager, Status, textOf } from '../ui';

export function MotorcyclesPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const page = Number(params.get('page') ?? '1') || 1;
  const verificationStatus = params.get('verificationStatus') ?? '';
  const registrationNumber = params.get('registrationNumber') ?? '';
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (verificationStatus) query.set('verificationStatus', verificationStatus);
  if (registrationNumber) query.set('registrationNumber', registrationNumber);
  const motorcycles = useQuery({
    queryKey: ['motorcycles', query.toString()],
    queryFn: () => adminApi.request<Page<MotorcycleRow>>(`/admin/motorcycles?${query.toString()}`),
  });
  const [choice, setChoice] = useState<{ id: string; decision: 'VERIFY' | 'REJECT' | 'REVOKE'; label: string } | null>(null);
  const review = useMutation({
    mutationFn: (next: { id: string; decision: 'VERIFY' | 'REJECT' | 'REVOKE' }) => adminApi.request(`/admin/motorcycles/${next.id}/verification`, {
      method: 'POST',
      body: { decision: next.decision },
    }),
    onSuccess: async () => {
      setChoice(null);
      await queryClient.invalidateQueries({ queryKey: ['motorcycles'] });
    },
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
        <div><p className="eyebrow">Fleet</p><h1>Motorcycles</h1></div>
      </div>
      <form className="filters" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        update({
          verificationStatus: String(data.get('verificationStatus') ?? ''),
          registrationNumber: String(data.get('registrationNumber') ?? '').trim(),
        });
      }}>
        <label>Verification
          <select name="verificationStatus" defaultValue={verificationStatus}>
            <option value="">Any</option>
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
            <option value="REVOKED">Revoked</option>
          </select>
        </label>
        <label>Registration
          <input name="registrationNumber" defaultValue={registrationNumber} />
        </label>
        <button className="button" type="submit">Apply</button>
      </form>
      {motorcycles.isLoading ? <Loading label="Loading motorcycles" /> : null}
      {motorcycles.error ? <ErrorNote>{textOf(motorcycles.error)}</ErrorNote> : null}
      {motorcycles.data && motorcycles.data.data.length === 0 ? <Empty>No motorcycles match these filters.</Empty> : null}
      {motorcycles.data && motorcycles.data.data.length > 0 ? (
        <>
          <div className="table-scroll panel">
            <table>
              <thead><tr><th>Registration</th><th>Rider</th><th>Vehicle</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {motorcycles.data.data.map((bike) => (
                  <tr key={bike.id}>
                    <td>{bike.registrationNumber}</td>
                    <td>{bike.rider ? <Link to={`/riders/${bike.riderProfileId}`}>{bike.rider.fullName}</Link> : '—'}</td>
                    <td>{bike.make} {bike.model} · {bike.colour}</td>
                    <td><Status value={bike.verificationStatus} /></td>
                    <td><BikeActions bike={bike} onChoose={setChoice} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="cards">
            {motorcycles.data.data.map((bike) => (
              <li key={bike.id}><article>
                <strong>{bike.registrationNumber}</strong>
                <span>{bike.rider?.fullName}</span>
                <Status value={bike.verificationStatus} />
                <BikeActions bike={bike} onChoose={setChoice} />
              </article></li>
            ))}
          </ul>
          <Pager page={motorcycles.data.pagination.page} totalPages={motorcycles.data.pagination.totalPages} onPage={(next) => update({ page: String(next) })} />
        </>
      ) : null}
      {choice ? (
        <Dialog
          title={`${label(choice.decision)} motorcycle`}
          danger={choice.decision !== 'VERIFY'}
          busy={review.isPending}
          confirmLabel="Confirm"
          onClose={() => { if (!review.isPending) setChoice(null); }}
          onConfirm={() => review.mutate(choice)}
        >
          <p>{label(choice.decision)} {choice.label}? Revoke is refused unless the rider is offline and has no accepted delivery.</p>
          {review.error ? <ErrorNote>{textOf(review.error)}</ErrorNote> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function BikeActions({ bike, onChoose }: { bike: MotorcycleRow; onChoose: (choice: { id: string; decision: 'VERIFY' | 'REJECT' | 'REVOKE'; label: string }) => void }) {
  if (bike.verificationStatus === 'PENDING') {
    return (
      <div className="actions">
        <button className="button" type="button" onClick={() => onChoose({ id: bike.id, decision: 'VERIFY', label: bike.registrationNumber })}>Verify</button>
        <button className="button-danger" type="button" onClick={() => onChoose({ id: bike.id, decision: 'REJECT', label: bike.registrationNumber })}>Reject</button>
      </div>
    );
  }
  if (bike.verificationStatus === 'VERIFIED') {
    return <button className="button-danger" type="button" onClick={() => onChoose({ id: bike.id, decision: 'REVOKE', label: bike.registrationNumber })}>Revoke</button>;
  }
  return null;
}
