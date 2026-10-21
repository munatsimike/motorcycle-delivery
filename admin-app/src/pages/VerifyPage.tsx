import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { BrandMark } from '../BrandMark';
import { useAuth } from '../auth';
import { ApiError } from '../lib/client';
import { ErrorNote } from '../ui';

export function VerifyPage() {
  const auth = useAuth();
  const location = useLocation();
  const challengeId = (location.state as { challengeId?: string } | null)?.challengeId ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.signedIn) {
    return <Navigate to="/" replace />;
  }
  if (!challengeId) {
    return <Navigate to="/sign-in" replace />;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\d{4,10}$/.test(code)) {
      setError('Enter the code from the email.');
      return;
    }
    setBusy(true);
    try {
      await auth.verify(challengeId, code);
      setCode('');
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
        <h1>Enter the email code</h1>
        <p className="lede">The code was sent to your administrator email. It expires quickly.</p>
        <label>Verification code
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} />
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <button className="button" type="submit" disabled={busy || code.length < 4}>{busy ? 'Checking' : 'Sign in'}</button>
        <Link to="/sign-in">Use a different email</Link>
      </form>
    </main>
  );
}
