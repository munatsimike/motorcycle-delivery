import { useEffect, useState } from 'react';

export function usePresence(open: boolean, closeMs: number) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setMounted(false), reduceMotion ? 0 : closeMs);
    return () => window.clearTimeout(timer);
  }, [closeMs, open]);

  return { mounted, visible };
}

export function motionClass(base: string, kind: 'sheet' | 'dialog', visible: boolean) {
  return `${base} motion-${kind}${visible ? ' is-open' : ''}`;
}
