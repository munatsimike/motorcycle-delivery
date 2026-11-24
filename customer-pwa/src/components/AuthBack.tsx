import { Link } from 'react-router-dom';
import { BackIcon } from './icons';

export function AuthBack({ to }: { to: string }) {
  return (
    <Link className="auth-back" to={to} aria-label="Back">
      <BackIcon />
    </Link>
  );
}
