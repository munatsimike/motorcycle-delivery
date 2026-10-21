import { useEffect, useId, useRef, type ReactNode } from 'react';
import { label } from './lib/labels';

const GOOD = new Set(['APPROVED', 'VERIFIED', 'DELIVERED', 'AVAILABLE', 'ACTIVE']);
const BAD = new Set(['REJECTED', 'SUSPENDED', 'REVOKED', 'CANCELLED', 'FAILED']);
const WARN = new Set(['PENDING', 'SEARCHING', 'NO_RIDER_FOUND', 'CREATED']);
const INFO = new Set(['BUSY', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_PICKUP', 'ARRIVED_AT_DROPOFF']);

export function Status({ value }: { value: string }) {
  const tone = GOOD.has(value) ? 'good' : BAD.has(value) ? 'bad' : WARN.has(value) ? 'warn' : INFO.has(value) ? 'info' : '';
  return <span className={`pill ${tone}`}>{label(value)}</span>;
}

export function Bars({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="bars">
      {items.map((item) => (
        <li key={item.label}>
          <span>{item.label}</span>
          <span className="track" aria-hidden="true">
            <span style={{ width: `${Math.round((item.value / max) * 100)}%` }} />
          </span>
          <b>{item.value}</b>
        </li>
      ))}
    </ul>
  );
}

export function textOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export function Loading({ label: text }: { label: string }) {
  return <p className="note" role="status">{text}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="error" role="alert">{children}</p>;
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return <p className="success" role="status">{children}</p>;
}

export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return (
    <div className="pager">
      <button className="button-secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {Math.max(totalPages, 1)}</span>
      <button className="button-secondary" type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

type DialogProps = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function Dialog({ title, children, confirmLabel, busy, danger, confirmDisabled, onConfirm, onClose }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.querySelector<HTMLElement>('button, input, textarea, select')?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        closeRef.current();
      }
      if (event.key !== 'Tab' || !node) {
        return;
      }
      const items = [...node.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href]')].filter((item) => !item.hasAttribute('disabled'));
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div className="dialog-scrim">
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="actions">
          <button className={danger ? 'button-danger' : 'button'} type="button" disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy ? 'Working' : confirmLabel}
          </button>
          <button className="button-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
