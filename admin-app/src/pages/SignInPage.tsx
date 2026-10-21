import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '../BrandMark';
import { useAuth } from '../auth';
import { ApiError } from '../lib/client';
import { ErrorNote } from '../ui';

export function SignInPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.signedIn) {
    return <Navigate to="/" replace />;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const challengeId = await auth.signIn(email.trim(), password);
      setPassword('');
      navigate('/verify', { state: { challengeId } });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card stack" onSubmit={(event) => void submit(event)}>
        <BrandMark />
        <p className="lede">Sign in with your administrator email and password.</p>
        {notice ? <p className="note">{notice}</p> : null}
        <label>Email
          <input autoComplete="username" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <button className="button" type="submit" disabled={busy}>{busy ? 'Sending code' : 'Continue'}</button>
      </form>
    </main>
  );
}
