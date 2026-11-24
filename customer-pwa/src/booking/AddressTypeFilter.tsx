import { useState } from 'react';
import { ChevronIcon } from '../components/icons';

export type AddressTypeChoice = 'ALL' | 'HOME' | 'WORK';

export function AddressTypeFilter({ value, onChange }: { value: AddressTypeChoice; onChange: (value: AddressTypeChoice) => void }) {
  const [open, setOpen] = useState(false);
  const choices: { value: AddressTypeChoice; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'HOME', label: 'Home' },
    { value: 'WORK', label: 'Work' },
  ];
  return (
    <>
      <button type="button" className="address-type-filter-trigger deliveries-tool" aria-label={`Filter addresses, ${value === 'ALL' ? 'All' : value === 'HOME' ? 'Home' : 'Work'}`} aria-expanded={open} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 13h12v-2H6v2Zm-2-4h16V7H4v2Zm4 8h8v-2H8v2Z" /></svg>
        <span>{value === 'ALL' ? 'All' : value === 'HOME' ? 'Home' : 'Work'}</span>
        <ChevronIcon size={18} />
      </button>
      {open ? (
        <div className="deliveries-sheet-backdrop address-filter-backdrop" onClick={() => setOpen(false)}>
          <div className="deliveries-sheet" role="dialog" aria-modal="true" aria-label="Filter addresses" onClick={(event) => event.stopPropagation()}>
            <h2>Filter</h2>
            <div role="radiogroup" aria-label="Address type">
              {choices.map((choice) => (
                <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} className={value === choice.value ? 'is-selected' : undefined} onClick={() => { onChange(choice.value); setOpen(false); }}>
                  <span>{choice.label}</span><span className="deliveries-radio" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
