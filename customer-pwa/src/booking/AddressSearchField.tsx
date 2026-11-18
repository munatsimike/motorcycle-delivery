import { useEffect, useRef } from 'react';

export function AddressSearchToggle({ labeled = true, expanded, onToggle }: { labeled?: boolean; expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={labeled ? 'address-search-toggle' : 'address-search-toggle is-icon'} aria-expanded={expanded} aria-label="Search saved addresses" onClick={onToggle}>
      <SearchGlyph />
      {labeled ? <span>Search</span> : null}
    </button>
  );
}

export function AddressSearchField({ value, onChange, onDismiss }: { value: string; onChange: (value: string) => void; onDismiss?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <label
      className="address-search-field"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        onDismiss?.();
      }}
    >
      <SearchGlyph />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search addresses"
        aria-label="Search saved addresses"
      />
      {onDismiss ? (
        <button type="button" className="address-search-clear" aria-label="Close search" onMouseDown={(event) => event.preventDefault()} onClick={onDismiss}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </label>
  );
}

function SearchGlyph() {
  return (
    <svg className="address-search-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
