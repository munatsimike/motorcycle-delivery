import type { ReactNode } from 'react';

export function Empty({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}
