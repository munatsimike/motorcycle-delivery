export function Loading({ label }: { label: string }) {
  return (
    <p className="note" role="status">
      {label}
    </p>
  );
}
