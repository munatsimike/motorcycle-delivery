import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type FullScreenProps = {
  backTo: string;
  backLabel: string;
  children: ReactNode;
};

export function FullScreen({ backTo, backLabel, children }: FullScreenProps) {
  return (
    <div className="fullscreen">
      <Link className="fullscreen-back" to={backTo}>{backLabel}</Link>
      {children}
    </div>
  );
}
