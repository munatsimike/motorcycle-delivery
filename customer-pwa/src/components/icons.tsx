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
