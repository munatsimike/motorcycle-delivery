import { useEffect, useRef, useState } from 'react';
import { fitOtpDigits, OTP_BOX_COUNT } from '../auth/code';

type OtpCodeBoxesProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
};

export function OtpCodeBoxes({ id, value, onChange, disabled = false, invalid = false }: OtpCodeBoxesProps) {
  const digits = fitOtpDigits(value);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!disabled) {
      inputs.current[0]?.focus();
    }
  }, [disabled]);

  function commit(next: string, focusIndex: number) {
    const fitted = fitOtpDigits(next);
    onChange(fitted);
    const target = Math.min(Math.max(focusIndex, 0), OTP_BOX_COUNT - 1);
    inputs.current[target]?.focus();
  }

  function writeFrom(index: number, raw: string) {
    const incoming = raw.replace(/\D/g, '');
    if (!incoming) {
      commit(`${digits.slice(0, index)}${digits.slice(index + 1)}`, index);
      return;
    }
    const next = `${digits.slice(0, index)}${incoming}${digits.slice(index + 1)}`;
    commit(next, index + incoming.length);
  }

  return (
    <div className="otp-boxes" role="group" aria-label="Verification code">
      {Array.from({ length: OTP_BOX_COUNT }, (_, index) => (
        <input
          key={index}
          id={index === 0 ? id : undefined}
          ref={(node) => { inputs.current[index] = node; }}
          className={[
            'otp-box',
            digits[index] ? 'is-filled' : '',
            activeIndex === index ? 'is-active' : '',
            invalid ? 'is-invalid' : '',
          ].filter(Boolean).join(' ')}
          value={digits[index] ?? ''}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoCorrect="off"
          spellCheck={false}
          autoFocus={index === 0}
          aria-label={`Digit ${index + 1}`}
          disabled={disabled}
          onFocus={(event) => {
            setActiveIndex(index);
            event.currentTarget.select();
          }}
          onPaste={(event) => {
            event.preventDefault();
            writeFrom(index, event.clipboardData.getData('text'));
          }}
          onChange={(event) => writeFrom(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace') {
              event.preventDefault();
              if (digits[index]) {
                commit(`${digits.slice(0, index)}${digits.slice(index + 1)}`, index);
                return;
              }
              if (index > 0) {
                commit(`${digits.slice(0, index - 1)}${digits.slice(index)}`, index - 1);
              }
              return;
            }
            if (event.key === 'ArrowLeft' && index > 0) {
              event.preventDefault();
              inputs.current[index - 1]?.focus();
            }
            if (event.key === 'ArrowRight' && index < OTP_BOX_COUNT - 1) {
              event.preventDefault();
              inputs.current[index + 1]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}
