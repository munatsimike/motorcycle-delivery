export function AddressSearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="address-search-field">
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search addresses"
        aria-label="Search saved addresses"
      />
      {value ? (
        <button type="button" className="address-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </label>
  );
}
