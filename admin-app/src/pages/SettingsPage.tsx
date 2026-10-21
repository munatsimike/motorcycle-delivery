import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../lib/client';
import { label } from '../lib/labels';
import { moneyValue, wholeMetres } from '../lib/money';
import type { CommissionPolicy, DeliveryPricing, WalletConfig } from '../lib/types';
import { Dialog, ErrorNote, Loading, SuccessNote, textOf } from '../ui';

type Draft =
  | { kind: 'wallet'; welcomeBonus: string; defaultBorrowingLimit: string; platformFee: string }
  | { kind: 'pricing'; baseFee: string; pricePerKilometre: string; minimumTripMetres: number; maximumTripMetres: number }
  | { kind: 'commission'; model: CommissionPolicy['model'] }
  | null;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet-config'], queryFn: () => adminApi.request<WalletConfig>('/admin/wallet-config') });
  const pricing = useQuery({ queryKey: ['pricing'], queryFn: () => adminApi.request<DeliveryPricing>('/admin/delivery-pricing') });
  const commission = useQuery({ queryKey: ['commission'], queryFn: () => adminApi.request<CommissionPolicy>('/admin/commission-policy') });
  const [draft, setDraft] = useState<Draft>(null);
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
      return adminApi.request('/admin/commission-policy', { method: 'PUT', body: { model: next.model } });
    },
    onSuccess: async () => {
      setDraft(null);
      setSuccess('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['wallet-config'] });
      await queryClient.invalidateQueries({ queryKey: ['pricing'] });
      await queryClient.invalidateQueries({ queryKey: ['commission'] });
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
      </section>
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
      {draft ? (
        <Dialog title="Save settings" busy={save.isPending} confirmLabel="Save" onClose={() => { if (!save.isPending) setDraft(null); }} onConfirm={() => save.mutate(draft)}>
          <DraftSummary draft={draft} />
          {save.error ? <ErrorNote>{textOf(save.error)}</ErrorNote> : null}
        </Dialog>
      ) : null}
    </div>
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
  return <p>Commission model: {label(draft.model)}.</p>;
}
