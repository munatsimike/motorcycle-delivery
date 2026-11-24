type IconProps = {
  size?: number;
};

const outline = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function BackIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12H4m0 0 7-7m-7 7 7 7" {...outline} />
    </svg>
  );
}

export function ChevronIcon({ direction = 'down', size = 24, className }: IconProps & { direction?: 'up' | 'down' | 'right'; className?: string }) {
  const path = direction === 'up' ? 'm6 15 6-6 6 6' : direction === 'right' ? 'm9 6 6 6-6 6' : 'm6 9 6 6 6-6';
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} {...outline} />
    </svg>
  );
}

export function AddIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" {...outline} />
    </svg>
  );
}

export function PhoneIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.6 3.5 9 6.8 7.5 9c1.4 3 3.5 5.1 6.5 6.5l2.2-1.5 3.3 2.4-.7 3c-.2.8-1 1.3-1.8 1.2C9.8 19.4 4.6 14.2 3.4 7c-.1-.8.4-1.6 1.2-1.8l2-.7Z" {...outline} />
    </svg>
  );
}
