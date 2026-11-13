import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
};

export function Input({ label, id, ...props }: InputProps) {
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input id={id} {...props} />
    </label>
  );
}
