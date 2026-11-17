export function Loading({ label }: { label: string }) {
  return (
    <div className="centered-loading" role="status" aria-live="polite">
      <span className="centered-loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
