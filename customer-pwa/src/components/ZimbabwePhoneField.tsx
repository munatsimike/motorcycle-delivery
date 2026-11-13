import flag from '../assets/zimbabwe-flag.png';
import { localPhoneEntry } from '../auth/phone';

type ZimbabwePhoneFieldProps = {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
};

export function ZimbabwePhoneField({
  id,
  label = 'Phone number',
  value,
  onChange,
  disabled = false,
  required = false,
}: ZimbabwePhoneFieldProps) {
  return (
    <label className="field" htmlFor={id}>
      {label}
      <span className="phone-field">
        <span className="phone-field-prefix">
          <img src={flag} alt="" width={28} height={22} />
          <span>+263</span>
        </span>
        <span className="phone-field-divider" aria-hidden="true" />
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Phone number"
          maxLength={16}
          value={value}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(localPhoneEntry(event.target.value))}
        />
      </span>
    </label>
  );
}
