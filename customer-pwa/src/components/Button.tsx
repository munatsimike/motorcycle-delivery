import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Shared = {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline';
};

type ButtonAsButton = Shared & ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined };
type ButtonAsLink = Shared & { to: string };

export function Button({ children, variant = 'primary', ...props }: ButtonAsButton | ButtonAsLink) {
  const className = variant === 'secondary'
    ? 'button button-secondary'
    : variant === 'outline'
      ? 'button button-outline'
      : 'button';
  if ('to' in props && props.to) {
    return (
      <Link className={className} to={props.to}>
        {children}
      </Link>
    );
  }
  const buttonProps = props as ButtonAsButton;
  return (
    <button type={buttonProps.type ?? 'button'} className={className} {...buttonProps}>
      {children}
    </button>
  );
}
