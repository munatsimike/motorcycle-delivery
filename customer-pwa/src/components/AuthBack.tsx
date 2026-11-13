import { Link } from 'react-router-dom';

export function AuthBack({ to }: { to: string }) {
  return (
    <Link className="auth-back" to={to} aria-label="Back">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
