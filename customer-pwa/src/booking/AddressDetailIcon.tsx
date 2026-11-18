export function AddressDetailIcon({ kind }: { kind: 'name' | 'address' | 'phone' }) {
  const path = kind === 'name'
    ? 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0'
    : kind === 'address'
      ? 'M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'
      : 'M6.6 3.5 9 6.8 7.5 9c1.4 3 3.5 5.1 6.5 6.5l2.2-1.5 3.3 2.4-.7 3c-.2.8-1 1.3-1.8 1.2C9.8 19.4 4.6 14.2 3.4 7c-.1-.8.4-1.6 1.2-1.8l2-.7Z';
  return (
    <svg className="address-detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
