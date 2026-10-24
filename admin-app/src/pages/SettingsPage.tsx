import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../lib/client';
import { label, when } from '../lib/labels';
import { moneyValue, wholeMetres } from '../lib/money';
import type { CommissionPolicy, DeliveryPricing, Page, PricingAudit, V2CommissionAudit, V2CommissionRate, WalletConfig } from '../lib/types';
import { basisPointsFromCommissionPercentage } from '../lib/v2-commission';
import { Dialog, Empty, ErrorNote, Loading, Pager, SuccessNote, textOf } from '../ui';
import { ClassPricingPanel } from './ClassPricingPanel';

type Draft =
  | { kind: 'wallet'; welcomeBonus: string; defaultBorrowingLimit: string; platformFee: string }
  | { kind: 'pricing'; baseFee: string; pricePerKilometre: string; minimumTripMetres: number; maximumTripMetres: number }
  | { kind: 'commission'; model: CommissionPolicy['model'] }
  | { kind: 'v2-commission'; percentage: string }
  | null;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet-config'], queryFn: () => adminApi.request<WalletConfig>('/admin/wallet-config') });
  const pricing = useQuery({ queryKey: ['pricing'], queryFn: () => adminApi.request<DeliveryPricing>('/admin/delivery-pricing') });
  const commission = useQuery({ queryKey: ['commission'], queryFn: () => adminApi.request<CommissionPolicy>('/admin/commission-policy') });
  const v2Commission = useQuery({ queryKey: ['v2-commission'], queryFn: () => adminApi.request<V2CommissionRate>('/admin/v2-commission-rate') });
  const [draft, setDraft] = useState<Draft>(null);
  const [section, setSection] = useState<'v1' | 'express' | 'flexible'>('v1');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (next: Exclude<Draft, null>) => {
      if (next.kind === 'wallet') {
        return adminApi.request('/admin/wallet-config', {
          method: 'PUT',
          body: {
            currency: 'USD',
            welcomeBonus: next.welcomeBonus,
            defaultBorrowingLimit: next.defaultBorrowingLimit,
            platformFee: next.platformFee,
          },
        });
      }
      if (next.kind === 'pricing') {
        return adminApi.request('/admin/delivery-pricing', { method: 'PUT', body: { currency: 'USD', baseFee: next.baseFee, pricePerKilometre: next.pricePerKilometre, minimumTripMetres: next.minimumTripMetres, maximumTripMetres: next.maximumTripMetres } });
      }
      if (next.kind === 'commission') {
        return adminApi.request('/admin/commission-policy', { method: 'PUT', body: { model: next.model } });
      }
      return adminApi.request('/admin/v2-commission-rate', { method: 'POST', body: { percentage: next.percentage } });
    },
    onSuccess: async () => {
      setDraft(null);
      setSuccess('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['wallet-config'] });
      await queryClient.invalidateQueries({ queryKey: ['pricing'] });
      await queryClient.invalidateQueries({ queryKey: ['commission'] });
      await queryClient.invalidateQueries({ queryKey: ['v2-commission'] });
      await queryClient.invalidateQueries({ queryKey: ['v2-commission-audits'] });
    },
  });

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Platform</p>
        <h1>Settings</h1>
      </div>
      {success ? <SuccessNote>{success}</SuccessNote> : null}
      {error || save.error ? <ErrorNote>{error ?? textOf(save.error)}</ErrorNote> : null}
      <section className="panel">
        <h2>Wallet configuration</h2>
        {wallet.isLoading ? <Loading label="Loading wallet configuration" /> : null}
        {wallet.error ? <ErrorNote>{textOf(wallet.error)}</ErrorNote> : null}
        {wallet.data ? (
          <MoneyForm
            key={wallet.data.configVersion}
            fields={[
              ['welcomeBonus', 'Welcome bonus', wallet.data.welcomeBonus],
              ['defaultBorrowingLimit', 'Default borrowing limit', wallet.data.defaultBorrowingLimit],
              ['platformFee', 'Platform fee', wallet.data.platformFee],
            ]}
            version={`Version ${wallet.data.configVersion}`}
            onSubmit={(values) => {
              setError(null);
              const welcomeBonus = moneyValue(values.welcomeBonus, true);
              const defaultBorrowingLimit = moneyValue(values.defaultBorrowingLimit, true);
              const platformFee = moneyValue(values.platformFee, true);
              if (!welcomeBonus || !defaultBorrowingLimit || !platformFee) {
                setError('Enter wallet amounts in dollars and cents. Zero is allowed.');
                return;
              }
              setDraft({ kind: 'wallet', welcomeBonus, defaultBorrowingLimit, platformFee });
            }}
          />
        ) : null}
      </section>
      <section className="panel">
        <h2>Delivery pricing</h2>
        <div className="tabs" role="tablist" aria-label="Pricing sections">
          {([
            ['v1', 'V1 Legacy'],
            ['express', 'Express'],
            ['flexible', 'Flexible'],
          ] as const).map(([id, title]) => (
            <button
              key={id}
              id={`pricing-tab-${id}`}
              className={section === id ? 'button' : 'button-secondary'}
              type="button"
              role="tab"
              aria-selected={section === id}
              aria-controls={`pricing-panel-${id}`}
              onClick={() => setSection(id)}
            >
              {title}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="pricing-panel-v1" aria-labelledby="pricing-tab-v1" hidden={section !== 'v1'}>
          <div className="stack">
            <h3>V1 legacy tariff</h3>
            {pricing.isLoading ? <Loading label="Loading delivery pricing" /> : null}
            {pricing.error ? <ErrorNote>{textOf(pricing.error)}</ErrorNote> : null}
            {pricing.data ? (
              <form key={pricing.data.pricingVersion} className="stack" onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                const data = new FormData(event.currentTarget);
                const baseFee = moneyValue(String(data.get('baseFee') ?? ''), true);
                const pricePerKilometre = moneyValue(String(data.get('pricePerKilometre') ?? ''), true);
                const minimumTripMetres = wholeMetres(String(data.get('minimumTripMetres') ?? ''));
                const maximumTripMetres = wholeMetres(String(data.get('maximumTripMetres') ?? ''));
                if (!baseFee || !pricePerKilometre || minimumTripMetres === null || maximumTripMetres === null || maximumTripMetres < minimumTripMetres) {
                  setError('Enter the tariff in dollars and cents, and a maximum distance that is at least the minimum.');
                  return;
                }
                setDraft({ kind: 'pricing', baseFee, pricePerKilometre, minimumTripMetres, maximumTripMetres });
              }}>
                <p className="muted">Version {pricing.data.pricingVersion}. Currency stays USD.</p>
                <label>Base fee<input name="baseFee" defaultValue={pricing.data.baseFee} /></label>
                <label>Price per kilometre<input name="pricePerKilometre" defaultValue={pricing.data.pricePerKilometre} /></label>
                <label>Minimum trip metres<input name="minimumTripMetres" defaultValue={String(pricing.data.minimumTripMetres)} /></label>
                <label>Maximum trip metres<input name="maximumTripMetres" defaultValue={String(pricing.data.maximumTripMetres)} /></label>
                <button className="button" type="submit">Review pricing</button>
              </form>
            ) : null}
          </div>
        </div>
        <div role="tabpanel" id="pricing-panel-express" aria-labelledby="pricing-tab-express" hidden={section !== 'express'}>
          <ClassPricingPanel serviceClass="EXPRESS" />
        </div>
        <div role="tabpanel" id="pricing-panel-flexible" aria-labelledby="pricing-tab-flexible" hidden={section !== 'flexible'}>
          <ClassPricingPanel serviceClass="FLEXIBLE" />
        </div>
      </section>
      <PricingHistory />
      <section className="panel">
        <h2>Commission policy</h2>
        {commission.isLoading ? <Loading label="Loading commission policy" /> : null}
        {commission.error ? <ErrorNote>{textOf(commission.error)}</ErrorNote> : null}
        {commission.data ? (
          <form key={commission.data.policyVersion} className="stack" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const model = String(data.get('model'));
            if (model !== 'ON_COMPLETION' && model !== 'ON_ACCEPTANCE') return;
            setDraft({ kind: 'commission', model });
          }}>
            <p className="muted">Version {commission.data.policyVersion}</p>
            <label>Model
              <select name="model" defaultValue={commission.data.model}>
                <option value="ON_COMPLETION">On completion</option>
                <option value="ON_ACCEPTANCE">On acceptance</option>
              </select>
            </label>
            <button className="button" type="submit">Review commission</button>
          </form>
        ) : null}
      </section>
      <section className="panel">
        <h2>V2 commission percentage</h2>
        <p className="muted">One percentage for every Express and Flexible delivery.</p>
        {v2Commission.isLoading ? <Loading label="Loading V2 commission" /> : null}
        {v2Commission.error ? <ErrorNote>{textOf(v2Commission.error)}</ErrorNote> : null}
        {v2Commission.data ? (
          <form key={v2Commission.data.configured ? v2Commission.data.rateVersion : 'unpublished'} className="stack" onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const data = new FormData(event.currentTarget);
            const percentage = String(data.get('percentage') ?? '');
            const basisPoints = basisPointsFromCommissionPercentage(percentage);
            if (basisPoints === null) {
              setError('Enter a commission percentage from 0 to 100, with at most two decimal places.');
              return;
            }
            setDraft({ kind: 'v2-commission', percentage: percentage.trim().replace(/%$/, '') });
          }}>
            {v2Commission.data.configured ? (
              <p className="muted">{v2Commission.data.percentage}% · Version {v2Commission.data.rateVersion}</p>
            ) : (
              <p>No V2 commission percentage has been published.</p>
            )}
            <label>Percentage<input name="percentage" inputMode="decimal" defaultValue={v2Commission.data.configured ? v2Commission.data.percentage : ''} /></label>
            <button className="button" type="submit">Review V2 commission</button>
          </form>
        ) : null}
      </section>
      <V2CommissionHistory />
      {draft ? (
        <Dialog title="Save settings" busy={save.isPending} confirmLabel="Save" onClose={() => { if (!save.isPending) setDraft(null); }} onConfirm={() => save.mutate(draft)}>
          <DraftSummary draft={draft} />
          {save.error ? <ErrorNote>{textOf(save.error)}</ErrorNote> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function PricingHistory() {
  const [page, setPage] = useState(1);
  const audits = useQuery({
    queryKey: ['pricing-audits', page],
    queryFn: () => adminApi.request<Page<PricingAudit>>(`/admin/delivery-pricing/audits?page=${page}&limit=20`),
  });
  return (
    <section className="panel">
      <h2>Pricing history</h2>
      <p className="muted">Each row shows the actor, the previous version, the next version, and the time. The audit does not name a service class.</p>
      {audits.isLoading ? <Loading label="Loading pricing history" /> : null}
      {audits.error ? (
        <div className="stack">
          <ErrorNote>{textOf(audits.error)}</ErrorNote>
          <button className="button-secondary" type="button" onClick={() => { void audits.refetch(); }}>Try again</button>
        </div>
      ) : null}
      {audits.data && audits.data.data.length === 0 ? <Empty>No pricing changes have been published.</Empty> : null}
      {audits.data && audits.data.data.length > 0 ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>When</th><th>Actor</th><th>Previous version</th><th>Next version</th></tr>
              </thead>
              <tbody>
                {audits.data.data.map((audit) => (
                  <tr key={audit.id}>
                    <td>{when(audit.createdAt)}</td>
                    <td>{audit.actorId}</td>
                    <td>{audit.previousVersion ?? 'None'}</td>
                    <td>{audit.nextVersion ?? 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audits.data.pagination.totalPages > 1 ? (
            <Pager page={audits.data.pagination.page} totalPages={audits.data.pagination.totalPages} onPage={setPage} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function V2CommissionHistory() {
  const [page, setPage] = useState(1);
  const audits = useQuery({
    queryKey: ['v2-commission-audits', page],
    queryFn: () => adminApi.request<Page<V2CommissionAudit>>(`/admin/v2-commission-rate/audits?page=${page}&limit=20`),
  });
  return (
    <section className="panel">
      <h2>V2 commission history</h2>
      <p className="muted">Each row shows who published the percentage, the previous version, and the next version.</p>
      {audits.isLoading ? <Loading label="Loading V2 commission history" /> : null}
      {audits.error ? (
        <div className="stack">
          <ErrorNote>{textOf(audits.error)}</ErrorNote>
          <button className="button-secondary" type="button" onClick={() => { void audits.refetch(); }}>Try again</button>
        </div>
      ) : null}
      {audits.data && audits.data.data.length === 0 ? <Empty>No V2 commission changes have been published.</Empty> : null}
      {audits.data && audits.data.data.length > 0 ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>When</th><th>Actor</th><th>Previous</th><th>Next</th></tr>
              </thead>
              <tbody>
                {audits.data.data.map((audit) => (
                  <tr key={audit.id}>
                    <td>{when(audit.createdAt)}</td>
                    <td>{audit.actorId}</td>
                    <td>{audit.previousPercentage === null ? 'None' : `${audit.previousPercentage}% · version ${audit.previousVersion}`}</td>
                    <td>{audit.nextPercentage}% · version {audit.nextVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audits.data.pagination.totalPages > 1 ? (
            <Pager page={audits.data.pagination.page} totalPages={audits.data.pagination.totalPages} onPage={setPage} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function MoneyForm({ fields, version, onSubmit }: { fields: Array<[string, string, string]>; version: string; onSubmit: (values: Record<string, string>) => void }) {
  return (
    <form className="stack" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      onSubmit(Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value)])));
    }}>
      <p className="muted">{version}. Currency stays USD.</p>
      {fields.map(([name, title, value]) => (
        <label key={name}>{title}<input name={name} defaultValue={value} /></label>
      ))}
      <button className="button" type="submit">Review wallet settings</button>
    </form>
  );
}

function DraftSummary({ draft }: { draft: Exclude<Draft, null> }) {
  if (draft.kind === 'wallet') {
    return <p>Welcome bonus USD {draft.welcomeBonus}, default borrowing limit USD {draft.defaultBorrowingLimit}, platform fee USD {draft.platformFee}.</p>;
  }
  if (draft.kind === 'pricing') {
    return <p>Base fee USD {draft.baseFee}, USD {draft.pricePerKilometre} per kilometre, {draft.minimumTripMetres} to {draft.maximumTripMetres} metres.</p>;
  }
  if (draft.kind === 'commission') {
    return <p>Commission model: {label(draft.model)}.</p>;
  }
  return <p>V2 commission {draft.percentage}% for Express and Flexible deliveries.</p>;
}
