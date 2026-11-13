type TopSpinnerProps = {
  active: boolean;
  label: string;
};

export function TopSpinner({ active, label }: TopSpinnerProps) {
  return (
    <div className="top-spinner" data-active={active ? 'true' : 'false'} role="status" aria-live="polite" aria-busy={active}>
      <span className="top-spinner-mark" aria-hidden="true" />
      <span className="visually-hidden">{active ? label : ''}</span>
    </div>
  );
}
