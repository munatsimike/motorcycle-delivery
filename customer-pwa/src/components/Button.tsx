import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'outline';
type Size = 'standard' | 'compact';

type Shared = {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
};

type ButtonAsButton = Shared & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { to?: undefined };
type ButtonAsLink = Shared & Omit<LinkProps, 'className' | 'children'> & { to: string };

function buttonClass(variant: Variant, size: Size, className?: string) {
  const names = ['button'];
  if (size === 'compact') names.push('button-compact');
  if (variant !== 'primary') names.push(`button-${variant}`);
  if (className) names.push(className);
  return names.join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonAsButton | ButtonAsLink>(function Button(
  { children, variant = 'primary', size = 'standard', className, ...props },
  ref,
) {
  const classes = buttonClass(variant, size, className);
  if ('to' in props && props.to) {
    const { to, ...linkProps } = props;
    return (
      <Link className={classes} to={to} {...linkProps}>
        {children}
      </Link>
    );
  }
  const buttonProps = props as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button ref={ref} {...buttonProps} type={buttonProps.type ?? 'button'} className={classes}>
      {children}
    </button>
  );
});
