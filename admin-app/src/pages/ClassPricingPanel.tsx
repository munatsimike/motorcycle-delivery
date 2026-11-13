import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  WEEKDAYS,
  crossesMidnight,
  draftFromTariff,
  emptyDraft,
  hasUnsavedEdits,
  matchesSavedWindow,
  overlapWarnings,
  percentFromBasisPoints,
  reviewClassTariff,
  serviceName,
  usesBaseFee,
  usesPerKilometre,
  type ClassDraft,
  type ClassPublishBody,
  type TierDraft,
  type WindowDraft,
} from '../lib/class-pricing';
import { adminApi, ApiError } from '../lib/client';
import { label } from '../lib/labels';
import type { ClassTariff, PricingModel, ServiceClassName } from '../lib/types';
import { Dialog, Empty, ErrorNote, Loading, SuccessNote, textOf } from '../ui';

const MODELS: Array<[PricingModel, string]> = [
  ['FIXED', 'Fixed price'],
  ['PER_KILOMETRE', 'Per kilometre'],
  ['BASE_PLUS_PER_KILOMETRE', 'Base fee plus per kilometre'],
  ['DISTANCE_TIERS', 'Distance tiers'],
  ['INCLUDED_DISTANCE', 'Included distance'],
];

export function ClassPricingPanel({ serviceClass }: { serviceClass: ServiceClassName }) {
  const name = serviceName(serviceClass);
  const queryClient = useQueryClient();
  const tariff = useQuery({
    queryKey: ['class-pricing', serviceClass],
    queryFn: async () => {
      try {
        return await adminApi.request<ClassTariff>(`/admin/delivery-pricing/classes/${serviceClass}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
  const serverKey = tariff.isSuccess ? String(tariff.data?.pricingVersion ?? 'none') : null;
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClassDraft | null>(null);
  if (serverKey !== null && serverKey !== appliedKey) {
    setAppliedKey(serverKey);
    setDraft(tariff.data ? draftFromTariff(tariff.data) : emptyDraft());
  }
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ClassPublishBody | null>(null);
  const [toggle, setToggle] = useState<{ windowId: string; enabled: boolean } | null>(null);
  const publishLock = useRef(false);
  const toggleLock = useRef(false);
  const publishFlight = useRef<Promise<ClassTariff> | null>(null);
  const toggleFlight = useRef<Promise<ClassTariff> | null>(null);

  const publish = useMutation({
    mutationFn: (body: ClassPublishBody) => once(publishFlight, () => adminApi.request<ClassTariff>(`/admin/delivery-pricing/classes/${serviceClass}`, {
      method: 'POST',
      body,
    })),
    onSuccess: async (next) => {
      queryClient.setQueryData(['class-pricing', serviceClass], next);
      setConfirm(null);
      setSuccess(`Published ${name} version ${next.pricingVersion}.`);
      await queryClient.invalidateQueries({ queryKey: ['class-pricing', serviceClass] });
      await queryClient.invalidateQueries({ queryKey: ['pricing-audits'] });
    },
  });
  const toggleWindow = useMutation({
    mutationFn: (next: { windowId: string; enabled: boolean }) => once(toggleFlight, () => adminApi.request<ClassTariff>(`/admin/delivery-pricing/classes/${serviceClass}/windows/${next.windowId}`, {
      method: 'POST',
      body: { enabled: next.enabled },
    })),
    onSuccess: async (next) => {
      queryClient.setQueryData(['class-pricing', serviceClass], next);
      setToggle(null);
      setSuccess(`Published ${name} version ${next.pricingVersion}.`);
      await queryClient.invalidateQueries({ queryKey: ['class-pricing', serviceClass] });
      await queryClient.invalidateQueries({ queryKey: ['pricing-audits'] });
    },
  });

  function change(next: ClassDraft) {
    setDraft(next);
    setFormError(null);
    setSuccess(null);
  }

  if (tariff.isPending && !draft) {
    return <Loading label={`Loading ${name} pricing`} />;
  }
  if (tariff.isError && !draft) {
    return (
      <div className="stack">
        <ErrorNote>{textOf(tariff.error)}</ErrorNote>
        <button className="button-secondary" type="button" onClick={() => { void tariff.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!draft) {
    return <Loading label={`Loading ${name} pricing`} />;
  }

  const warnings = overlapWarnings(draft.windows);
  const saved = tariff.data;

  return (
    <div className="stack">
      <h3>{name} tariff</h3>
      {success ? <SuccessNote>{success}</SuccessNote> : null}
      {tariff.isError ? (
        <div className="stack">
          <ErrorNote>{textOf(tariff.error)}</ErrorNote>
          <button className="button-secondary" type="button" onClick={() => { void tariff.refetch(); }}>Try again</button>
        </div>
      ) : null}
      {tariff.isSuccess && !saved ? <Empty>{name} pricing has not been published. Enter a tariff to publish the first version. No price is filled in for you.</Empty> : null}
      {formError ? <ErrorNote>{formError}</ErrorNote> : null}
      <form className="stack" autoComplete="off" onSubmit={(event) => {
        event.preventDefault();
        if (!draft.pricingModel) {
          setFormError('Choose a pricing model.');
          return;
        }
        const reviewed = reviewClassTariff(draft);
        if ('error' in reviewed) {
          setFormError(reviewed.error);
          return;
        }
        setFormError(null);
        setConfirm(reviewed.body);
      }}>
        <p className="muted">{saved ? `Version ${saved.pricingVersion}. ` : ''}Currency USD.</p>
        <label>Pricing model
          <select value={draft.pricingModel} onChange={(event) => change({ ...draft, pricingModel: readModel(event.target.value) })}>
            <option value="">Choose a model</option>
            {MODELS.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select>
        </label>
        {draft.pricingModel ? (
          <>
            {draft.pricingModel === 'INCLUDED_DISTANCE' ? (
              <>
                <label>Base price (USD)<input value={draft.baseFee} onChange={(event) => change({ ...draft, baseFee: event.target.value })} /></label>
                <label>Included distance (km)<input inputMode="decimal" value={draft.includedKilometres} onChange={(event) => change({ ...draft, includedKilometres: event.target.value })} /></label>
                <label>Additional price per kilometre (USD)<input value={draft.pricePerKilometre} onChange={(event) => change({ ...draft, pricePerKilometre: event.target.value })} /></label>
              </>
            ) : (
              <>
                {usesBaseFee(draft.pricingModel) ? (
                  <label>Base fee<input value={draft.baseFee} onChange={(event) => change({ ...draft, baseFee: event.target.value })} /></label>
                ) : null}
                {usesPerKilometre(draft.pricingModel) ? (
                  <label>Price per kilometre<input value={draft.pricePerKilometre} onChange={(event) => change({ ...draft, pricePerKilometre: event.target.value })} /></label>
                ) : null}
              </>
            )}
            <label>Minimum trip metres<input inputMode="numeric" value={draft.minimumTripMetres} onChange={(event) => change({ ...draft, minimumTripMetres: event.target.value })} /></label>
            <label>Maximum trip metres<input inputMode="numeric" value={draft.maximumTripMetres} onChange={(event) => change({ ...draft, maximumTripMetres: event.target.value })} /></label>
            {draft.pricingModel === 'DISTANCE_TIERS' ? (
              <div className="stack">
                <p className="muted">Each tier applies only to its own slice. The first slice starts at 0 metres. The next slice starts at the previous boundary, and the last boundary must equal the maximum trip. Quotes outside the minimum and maximum are still rejected.</p>
                {draft.tiers.map((tier, index) => (
                  <section className="editor-card" key={tier.key} aria-label={`Tier ${index + 1}`}>
                    <h4>Tier {index + 1}</h4>
                    <label>Upper boundary in metres<input inputMode="numeric" value={tier.upToMetres} onChange={(event) => change(updateTier(draft, tier.key, { upToMetres: event.target.value }))} /></label>
                    <label>Rate per kilometre<input value={tier.amount} onChange={(event) => change(updateTier(draft, tier.key, { amount: event.target.value }))} /></label>
                    <div className="actions">
                      <button className="button-secondary" type="button" disabled={index === 0} onClick={() => change({ ...draft, tiers: moveItem(draft.tiers, index, -1) })}>Move tier earlier</button>
                      <button className="button-secondary" type="button" disabled={index === draft.tiers.length - 1} onClick={() => change({ ...draft, tiers: moveItem(draft.tiers, index, 1) })}>Move tier later</button>
                      <button className="button-secondary" type="button" onClick={() => change({ ...draft, tiers: draft.tiers.filter((item) => item.key !== tier.key) })}>Remove tier</button>
                    </div>
                  </section>
                ))}
                <button className="button-secondary" type="button" onClick={() => change({ ...draft, tiers: [...draft.tiers, { key: newKey(), upToMetres: '', amount: '' }] })}>Add tier</button>
              </div>
            ) : null}
            <div className="stack">
              <p className="muted">Only one window applies. Night takes priority over Peak, and Peak takes priority over Off-peak. Windows do not stack. The end minute is not included. A published window is turned on or off by publishing the next version, and the previous version stays unchanged.</p>
              {warnings.map((warning, index) => <p className="note" role="status" key={`${warning}-${index}`}>{warning}</p>)}
              {draft.windows.map((window, index) => {
                const savedWindow = saved?.windows.find((item) => item.id === window.id) ?? null;
                const publishedMatch = savedWindow ? matchesSavedWindow(window, savedWindow) : false;
                return (
                  <section className="editor-card" key={window.key} aria-label={`Window ${index + 1}`} data-window-id={window.id ?? ''}>
                    <h4>Window {index + 1}</h4>
                    <label>Window
                      <select value={window.kind} onChange={(event) => change(updateWindow(draft, window.key, { kind: event.target.value as WindowDraft['kind'] }))}>
                        <option value="PEAK">Peak</option>
                        <option value="OFF_PEAK">Off-peak</option>
                        <option value="NIGHT">Night</option>
                      </select>
                    </label>
                    <fieldset>
                      <legend>Days</legend>
                      <div className="days">
                        {WEEKDAYS.map((day) => (
                          <label key={day.value}>
                            <input
                              type="checkbox"
                              checked={window.daysOfWeek.includes(day.value)}
                              onChange={() => change(updateWindow(draft, window.key, { daysOfWeek: toggleDay(window.daysOfWeek, day.value) }))}
                            />
                            {day.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <label>Starts<input value={window.startsAt} placeholder="HH:MM" onChange={(event) => change(updateWindow(draft, window.key, { startsAt: event.target.value }))} /></label>
                    <label>Ends<input value={window.endsAt} placeholder="HH:MM" onChange={(event) => change(updateWindow(draft, window.key, { endsAt: event.target.value }))} /></label>
                    {crossesMidnight(window.startsAt, window.endsAt) ? <p className="muted">This window crosses midnight. An end time equal to the start stays open for 24 hours from that time.</p> : null}
                    <label>Price adjustment (%)
                      <input value={window.percent} onChange={(event) => change(updateWindow(draft, window.key, { percent: event.target.value }))} />
                    </label>
                    <p className="muted">Enter a percentage. 5 is +5% and -2.5 is −2.5%.</p>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={window.enabled}
                        onChange={() => {
                          if (publishedMatch && savedWindow) {
                            setToggle({ windowId: savedWindow.id, enabled: !savedWindow.enabled });
                            return;
                          }
                          change(updateWindow(draft, window.key, { enabled: !window.enabled }));
                        }}
                      />
                      Enabled
                    </label>
                    {window.id ? <p className="muted">{publishedMatch ? 'This saved window publishes a new version when enabled or disabled.' : 'Unpublished window edits are included when you publish the tariff.'}</p> : <p className="muted">This window is included when you publish the tariff.</p>}
                    <button className="button-secondary" type="button" onClick={() => change({ ...draft, windows: draft.windows.filter((item) => item.key !== window.key) })}>Remove window</button>
                  </section>
                );
              })}
              <button className="button-secondary" type="button" onClick={() => change({
                ...draft,
                windows: [...draft.windows, {
                  key: newKey(),
                  id: null,
                  kind: 'PEAK',
                  enabled: true,
                  daysOfWeek: [],
                  startsAt: '',
                  endsAt: '',
                  percent: '',
                }],
              })}>Add window</button>
              <p className="muted">Removing a window takes effect on the next published version. Older versions keep their windows.</p>
            </div>
            <button className="button" type="submit" disabled={publish.isPending}>Review and publish</button>
          </>
        ) : null}
      </form>
      {confirm ? (
        <Dialog title={`Publish ${name} pricing`} confirmLabel="Publish" busy={publish.isPending} onClose={() => { if (!publish.isPending) { setConfirm(null); publish.reset(); } }} onConfirm={() => {
          if (publishLock.current) {
            return;
          }
          publishLock.current = true;
          publish.mutate(confirm, { onSettled: () => { publishLock.current = false; } });
        }}>
          <PublishSummary serviceClass={serviceClass} body={confirm} />
          {publish.error ? <ErrorNote>{textOf(publish.error)}</ErrorNote> : null}
        </Dialog>
      ) : null}
      {toggle ? (
        <Dialog title={`Publish ${name} window`} confirmLabel="Publish window" busy={toggleWindow.isPending} onClose={() => { if (!toggleWindow.isPending) { setToggle(null); toggleWindow.reset(); } }} onConfirm={() => {
          if (toggleLock.current) {
            return;
          }
          toggleLock.current = true;
          toggleWindow.mutate(toggle, { onSettled: () => { toggleLock.current = false; } });
        }}>
          <p>Turning this window {toggle.enabled ? 'on' : 'off'} publishes a new {name} tariff version. The previous version stays unchanged, and the new window identifiers replace the saved ones.</p>
          {hasUnsavedEdits(draft, saved ?? null) ? <p>Other unsaved edits on this form are replaced by the saved tariff.</p> : null}
          {toggleWindow.error ? <ErrorNote>{textOf(toggleWindow.error)}</ErrorNote> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function PublishSummary({ serviceClass, body }: { serviceClass: ServiceClassName; body: ClassPublishBody }) {
  return (
    <div className="stack">
      <p>{serviceName(serviceClass)} tariff. Model: {label(body.pricingModel)}. Currency USD. {body.minimumTripMetres} to {body.maximumTripMetres} metres.</p>
      {body.includedMetres !== undefined ? (
        <p>Base price USD {body.baseFee} includes {body.includedMetres} metres. Additional distance is USD {body.pricePerKilometre} per kilometre.</p>
      ) : (
        <>
          {body.baseFee !== undefined ? <p>Base fee USD {body.baseFee}.</p> : null}
          {body.pricePerKilometre !== undefined ? <p>USD {body.pricePerKilometre} per kilometre.</p> : null}
        </>
      )}
      {body.tiers ? (
        <ul>
          {body.tiers.map((tier) => <li key={tier.position}>Tier {tier.position}: up to {tier.upToMetres} metres at USD {tier.amount} per kilometre.</li>)}
        </ul>
      ) : null}
      {body.windows.length === 0 ? <p>No pricing windows.</p> : (
        <ul>
          {body.windows.map((window, index) => (
            <li key={index}>
              {label(window.kind)}, {dayNames(window.daysOfWeek)}, {window.startsAt}–{window.endsAt}
              {crossesMidnight(window.startsAt, window.endsAt) ? ', crosses midnight' : ''}, {percentFromBasisPoints(window.adjustmentBasisPoints)}%, {window.enabled ? 'enabled' : 'disabled'}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function once<T>(slot: { current: Promise<T> | null }, run: () => Promise<T>): Promise<T> {
  if (slot.current) {
    return slot.current;
  }
  const flight = run().finally(() => {
    slot.current = null;
  });
  slot.current = flight;
  return flight;
}

function readModel(value: string): ClassDraft['pricingModel'] {
  if (value === 'FIXED' || value === 'PER_KILOMETRE' || value === 'BASE_PLUS_PER_KILOMETRE' || value === 'DISTANCE_TIERS' || value === 'INCLUDED_DISTANCE') {
    return value;
  }
  return '';
}

function updateTier(draft: ClassDraft, key: string, patch: Partial<TierDraft>): ClassDraft {
  return { ...draft, tiers: draft.tiers.map((tier) => tier.key === key ? { ...tier, ...patch } : tier) };
}

function updateWindow(draft: ClassDraft, key: string, patch: Partial<WindowDraft>): ClassDraft {
  return { ...draft, windows: draft.windows.map((window) => window.key === key ? { ...window, ...patch } : window) };
}

function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((item) => item !== day) : [...days, day];
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction;
  if (next < 0 || next >= items.length) {
    return items;
  }
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  if (!item) {
    return items;
  }
  copy.splice(next, 0, item);
  return copy;
}

function dayNames(days: number[]): string {
  return WEEKDAYS.filter((day) => days.includes(day.value)).map((day) => day.label).join(', ');
}

function newKey(): string {
  return crypto.randomUUID();
}
