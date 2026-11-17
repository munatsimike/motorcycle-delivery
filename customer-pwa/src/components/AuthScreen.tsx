import type { ReactNode } from 'react';
import { useContainedScroll } from '../app/useContainedScroll';

export function AuthScreen({ children }: { children: ReactNode }) {
  const ref = useContainedScroll<HTMLDivElement>();
  return (
    <div ref={ref} className="auth-screen page-stage is-entering">
      {children}
    </div>
  );
}
