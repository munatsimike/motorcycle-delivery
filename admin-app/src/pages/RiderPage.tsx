import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, recordTopUp, type TopUpResult } from '../lib/client';
import { label, when } from '../lib/labels';
import { moneyValue, newTopUpKey, type TopUpDraft, type TopUpMethod } from '../lib/money';
import type { RiderDetail, RiderWalletSummary } from '../lib/types';
import { Dialog, ErrorNote, Loading, Status, SuccessNote, textOf } from '../ui';

type Confirm =
  | { kind: 'licence-verify'; licenceNumber: string; licenceClass: string }
  | { kind: 'licence-reject'; reason: string }
  | { kind: 'approve' }
  | { kind: 'suspend' }
  | { kind: 'motorcycle'; id: string; decision: 'VERIFY' | 'REJECT' | 'REVOKE'; label: string }
  | null;

export function RiderPage() {
  const { riderProfileId = '' } = useParams();
  const queryClient = useQueryClient();
  const rider = useQuery({
    queryKey: ['rider', riderProfileId],
    queryFn: () => adminApi.request<RiderDetail>(`/admin/riders/${riderProfileId}`),
  });
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceClass, setLicenceClass] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<TopUpMethod>('CASH');
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState('');
  const [received, setReceived] = useState(false);
  const [topUp, setTopUp] = useState<TopUpDraft | null>(null);
  const [topUpResult, setTopUpResult] = useState<TopUpResult | null>(null);
  const [limitAmount, setLimitAmount] = useState('');
  const [limitDraft, setLimitDraft] = useState<{ borrowingLimit: string | null } | null>(null);
  const wallet = useQuery({
    queryKey: ['rider-wallet', riderProfileId],
    queryFn: () => adminApi.request<RiderWalletSummary>(`/admin/riders/${riderProfileId}/wallet`),
    enabled: riderProfileId.length > 0,
  });

  const action = useMutation({
    mutationFn: async (next: Exclude<Confirm, null>) => {
      if (next.kind === 'licence-verify' || next.kind === 'licence-reject') {
        const imageId = rider.data?.licenceImage?.id;
        if (!imageId) {
          throw new Error('No stored licence image is waiting for review.');
        }
        const body = next.kind === 'licence-verify'
          ? { decision: 'VERIFY', licenceImageId: imageId, licenceNumber: next.licenceNumber, licenceClass: next.licenceClass }
          : { decision: 'REJECT', licenceImageId: imageId, rejectionReason: next.reason };
        return adminApi.request(`/admin/riders/${riderProfileId}/licence-verification`, { method: 'POST', body });
      }
      if (next.kind === 'approve' || next.kind === 'suspend') {
        return adminApi.request(`/admin/riders/${riderProfileId}/approval`, {
          method: 'POST',
          body: { decision: next.kind === 'approve' ? 'APPROVE' : 'SUSPEND' },
        });
      }
      return adminApi.request(`/admin/motorcycles/${next.id}/verification`, {
        method: 'POST',
        body: { decision: next.decision },
      });
    },
    onSuccess: async () => {
      setSuccess('Saved.');
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: ['rider', riderProfileId] });
    },
  });

  const limit = useMutation({
    mutationFn: (body: { borrowingLimit: string | null }) => adminApi.request<RiderWalletSummary>(`/admin/riders/${riderProfileId}/wallet/negative-limit`, {
      method: 'PUT',
      body,
    }),
    onSuccess: async (result) => {
      setLimitDraft(null);
      setLimitAmount('');
      setSuccess('Negative wallet limit saved.');
      queryClient.setQueryData(['rider-wallet', riderProfileId], result);
    },
  });

  const payment = useMutation({
    mutationFn: (draft: TopUpDraft) => recordTopUp(riderProfileId, draft),
    onSuccess: (result) => {
      setTopUp(null);
      setReceived(false);
      setTopUpResult(result);
      setSuccess(result.replayed ? 'This payment was already recorded.' : 'Top-up recorded.');
    },
  });

  if (rider.isLoading) return <Loading label="Loading the rider" />;
  if (rider.error) return <ErrorNote>{textOf(rider.error)}</ErrorNote>;
  if (!rider.data) return <ErrorNote>Rider not found.</ErrorNote>;
  const person = rider.data;
  const canReviewLicence = person.verificationStatus === 'PENDING' && person.licenceImage;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Rider</p>
          <h1>{person.fullName}</h1>
          <p className="muted">{person.phone}{person.email ? ` · ${person.email}` : ''}</p>
        </div>
        <Link to="/riders">All riders</Link>
      </div>
      {success ? <SuccessNote>{success}</SuccessNote> : null}
      {formError || action.error ? <ErrorNote>{formError ?? textOf(action.error)}</ErrorNote> : null}
      <section className="kpis">
        <article className="kpi"><span>Account approval</span><Status value={person.approvalStatus} /></article>
        <article className="kpi"><span>Driving licence</span><Status value={person.verificationStatus} /></article>
        <article className="kpi"><span>Availability</span><Status value={person.availability} /></article>
        <article className="kpi"><span>Account</span><Status value={person.accountStatus} /></article>
      </section>
      <section className="panel">
        <h2>Driving licence</h2>
        {person.licenceNumber ? <p>Number {person.licenceNumber} · class {person.licenceClass}</p> : <p className="muted">No verified licence number is on file.</p>}
        {person.verifiedAt ? <p className="muted">Verified {when(person.verifiedAt)}</p> : null}
        <LicenceImage riderProfileId={person.riderProfileId} imageId={person.licenceImage?.id ?? null} />
        {canReviewLicence ? (
          <div className="stack">
            <label>Licence number
              <input value={licenceNumber} onChange={(event) => setLicenceNumber(event.target.value)} />
            </label>
            <label>Licence class
              <input value={licenceClass} onChange={(event) => setLicenceClass(event.target.value)} />
            </label>
            <label>Rejection reason
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="actions">
              <button className="button" type="button" onClick={() => {
                setFormError(null);
                if (!licenceNumber.trim() || !licenceClass.trim()) {
                  setFormError('Enter the licence number and class.');
                  return;
                }
                setConfirm({ kind: 'licence-verify', licenceNumber: licenceNumber.trim(), licenceClass: licenceClass.trim() });
              }}>Verify licence</button>
              <button className="button-danger" type="button" onClick={() => {
                setFormError(null);
                if (!reason.trim()) {
                  setFormError('Enter the reason for rejecting the licence.');
                  return;
                }
                setConfirm({ kind: 'licence-reject', reason: reason.trim() });
              }}>Reject licence</button>
            </div>
          </div>
        ) : <p className="note">Licence review is available when a stored image is pending.</p>}
      </section>
      <section className="panel">
        <h2>Approval</h2>
        <p className="muted">Approval stays separate from the licence review. The server still requires a verified licence and a verified motorcycle before approval.</p>
        <div className="actions">
          {person.approvalStatus === 'PENDING' || person.approvalStatus === 'SUSPENDED' ? (
            <button className="button" type="button" onClick={() => setConfirm({ kind: 'approve' })}>Approve rider</button>
          ) : null}
          {person.approvalStatus === 'APPROVED' ? (
            <button className="button-danger" type="button" onClick={() => setConfirm({ kind: 'suspend' })}>Suspend rider</button>
          ) : null}
        </div>
      </section>
      <section className="panel">
        <h2>Motorcycles</h2>
        {person.motorcycles.length === 0 ? <p className="note">No motorcycles are registered.</p> : (
          <ul className="cards" style={{ display: 'grid' }}>
            {person.motorcycles.map((bike) => (
              <li key={bike.id}><article>
                <strong>{bike.registrationNumber}</strong>
                <span>{bike.make} {bike.model} · {bike.colour}</span>
                <span>Verification <Status value={bike.verificationStatus} /> {bike.isActive ? '· Active motorcycle' : ''}</span>
                <div className="actions">
                  {bike.verificationStatus === 'PENDING' ? (
                    <>
                      <button className="button" type="button" onClick={() => setConfirm({ kind: 'motorcycle', id: bike.id, decision: 'VERIFY', label: bike.registrationNumber })}>Verify</button>
                      <button className="button-danger" type="button" onClick={() => setConfirm({ kind: 'motorcycle', id: bike.id, decision: 'REJECT', label: bike.registrationNumber })}>Reject</button>
                    </>
                  ) : null}
                  {bike.verificationStatus === 'VERIFIED' ? (
                    <button className="button-danger" type="button" onClick={() => setConfirm({ kind: 'motorcycle', id: bike.id, decision: 'REVOKE', label: bike.registrationNumber })}>Revoke</button>
                  ) : null}
                </div>
              </article></li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h2>Negative wallet limit</h2>
        <p className="muted">Platform fees can be deducted while the balance is below zero. Saving a limit does not change the wallet balance or open reservations.</p>
        {wallet.isLoading ? <Loading label="Loading the negative wallet limit" /> : null}
        {wallet.error ? <ErrorNote>{textOf(wallet.error)}</ErrorNote> : null}
        {wallet.data ? (
          <div className="stack">
            <div className="facts">
              <div><span>Effective limit</span><b>{wallet.data.currency} {wallet.data.borrowingLimit}</b></div>
              <div><span>Source</span><b>{limitSource(wallet.data.borrowingLimitSource)}</b></div>
              <div><span>Balance</span><b>{wallet.data.currency} {wallet.data.balance}</b></div>
            </div>
            <label>Custom limit (USD)
              <input value={limitAmount} onChange={(event) => setLimitAmount(event.target.value)} placeholder="1.00" />
            </label>
            <div className="actions">
              <button className="button" type="button" disabled={limit.isPending} onClick={() => {
                setFormError(null);
                const parsed = moneyValue(limitAmount, true);
                if (!parsed) {
                  setFormError('Enter the limit in dollars and cents. Zero is allowed.');
                  return;
                }
                setLimitDraft({ borrowingLimit: parsed });
              }}>Review custom limit</button>
              <button className="button-secondary" type="button" disabled={limit.isPending || wallet.data.borrowingLimitSource !== 'OVERRIDE'} onClick={() => {
                setFormError(null);
                setLimitDraft({ borrowingLimit: null });
              }}>Use the global default</button>
            </div>
          </div>
        ) : null}
      </section>
      <section className="panel">
        <h2>Manual top-up</h2>
        <p className="muted">Record a payment already received outside the app. This page does not calculate the wallet balance.</p>
        <label>Amount (USD)
          <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="10.00" />
        </label>
        <label>Method
          <select value={method} onChange={(event) => setMethod(event.target.value as TopUpMethod)}>
            <option value="CASH">Cash</option>
            <option value="ECOCASH">EcoCash</option>
          </select>
        </label>
        {method === 'CASH' ? (
          <label>Cash receipt
            <input value={receipt} onChange={(event) => setReceipt(event.target.value)} />
          </label>
        ) : (
          <label>EcoCash reference
            <input value={reference} onChange={(event) => setReference(event.target.value)} />
          </label>
        )}
        <button className="button" type="button" disabled={payment.isPending} onClick={() => {
          setFormError(null);
          const parsed = moneyValue(amount, false);
          if (!parsed) {
            setFormError('Enter the amount in dollars and cents, greater than zero.');
            return;
          }
          if (method === 'ECOCASH' && !reference.trim()) {
            setFormError('Enter the EcoCash reference.');
            return;
          }
          setTopUp({
            idempotencyKey: newTopUpKey(),
            amount: parsed,
            method,
            externalReceiptNumber: method === 'CASH' && receipt.trim() ? receipt.trim() : null,
            ecocashReference: method === 'ECOCASH' ? reference.trim() : null,
          });
          setReceived(false);
        }}>Review top-up</button>
        {topUpResult ? <p className="note">Recorded {topUpResult.currency} {topUpResult.amount}. Server balance {topUpResult.currency} {topUpResult.balance}.</p> : null}
      </section>
      {confirm ? (
        <Dialog
          title={confirm.kind === 'suspend' || confirm.kind === 'licence-reject' || (confirm.kind === 'motorcycle' && confirm.decision !== 'VERIFY') ? 'Confirm this decision' : 'Confirm'}
          danger={confirm.kind === 'suspend' || confirm.kind === 'licence-reject' || (confirm.kind === 'motorcycle' && confirm.decision !== 'VERIFY')}
          busy={action.isPending}
          confirmLabel="Confirm"
          onClose={() => { if (!action.isPending) setConfirm(null); }}
          onConfirm={() => action.mutate(confirm)}
        >
          <p>{confirmText(confirm, person.fullName)}</p>
          {action.error ? <ErrorNote>{textOf(action.error)}</ErrorNote> : null}
        </Dialog>
      ) : null}
      {limitDraft ? (
        <Dialog
          title="Save negative wallet limit"
          busy={limit.isPending}
          confirmLabel="Save limit"
          onClose={() => { if (!limit.isPending) setLimitDraft(null); }}
          onConfirm={() => limit.mutate(limitDraft)}
        >
          <p>
            {limitDraft.borrowingLimit === null
              ? `Use the global default for this rider. The balance stays ${wallet.data?.currency ?? 'USD'} ${wallet.data?.balance ?? ''}.`
              : `Set this rider's negative wallet limit to USD ${limitDraft.borrowingLimit}. The balance stays ${wallet.data?.currency ?? 'USD'} ${wallet.data?.balance ?? ''}.`}
          </p>
          {limit.error ? <ErrorNote>{textOf(limit.error)}</ErrorNote> : null}
        </Dialog>
      ) : null}
      {topUp ? (
        <Dialog
          title="Confirm top-up"
          busy={payment.isPending}
          confirmDisabled={!received}
          confirmLabel={payment.error ? 'Try the same payment again' : 'Record payment'}
          onClose={() => { if (!payment.isPending) setTopUp(null); }}
          onConfirm={() => payment.mutate(topUp)}
        >
          <div className="facts">
            <div><span>Rider</span><b>{person.fullName}</b></div>
            <div><span>Phone</span><b>{person.phone}</b></div>
            <div><span>Amount</span><b>USD {topUp.amount}</b></div>
            <div><span>Method</span><b>{label(topUp.method)}</b></div>
            {topUp.ecocashReference ? <div><span>EcoCash reference</span><b>{topUp.ecocashReference}</b></div> : null}
            {topUp.externalReceiptNumber ? <div><span>Cash receipt</span><b>{topUp.externalReceiptNumber}</b></div> : null}
          </div>
          <label className="check">
            <input type="checkbox" checked={received} onChange={(event) => setReceived(event.target.checked)} />
            <span>I confirm this payment was received.</span>
          </label>
          {payment.error ? <ErrorNote>{textOf(payment.error)} The same payment can be tried again without creating a second credit.</ErrorNote> : null}
          {payment.error ? (
            <button className="button-secondary" type="button" onClick={() => { setTopUp(null); payment.reset(); }}>
              This is a different payment
            </button>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function limitSource(source: string): string {
  return source === 'OVERRIDE' ? 'Account-specific limit' : 'Standard limit';
}

function confirmText(confirm: Exclude<Confirm, null>, name: string): string {
  if (confirm.kind === 'approve') return `Approve ${name}? The server will refuse this if the licence or motorcycle is not verified.`;
  if (confirm.kind === 'suspend') return `Suspend ${name}? The server will refuse this during an accepted delivery.`;
  if (confirm.kind === 'licence-verify') return `Verify licence ${confirm.licenceNumber}, class ${confirm.licenceClass}?`;
  if (confirm.kind === 'licence-reject') return `Reject the licence? Reason: ${confirm.reason}`;
  return `${label(confirm.decision)} motorcycle ${confirm.label}?`;
}

function LicenceImage({ riderProfileId, imageId }: { riderProfileId: string; imageId: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!imageId) return;
    let url: string | null = null;
    let live = true;
    adminApi.requestBlob(`/admin/riders/${riderProfileId}/licence-image`).then((blob) => {
      if (!live) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch((caught: unknown) => {
      if (live) setError(textOf(caught));
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [imageId, riderProfileId]);
  if (!imageId) return null;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!src) return <Loading label="Loading the licence image" />;
  return <img className="licence-image" src={src} alt="Driving licence submitted by the rider" />;
}
