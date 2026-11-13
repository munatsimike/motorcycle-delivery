import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  resendWhatsAppLogin,
  resendWhatsAppRegistration,
  startWhatsAppLogin,
  startWhatsAppRegistration,
  verifyWhatsAppLogin,
  verifyWhatsAppRegistration,
} from '../auth/api';
import { fitOtpDigits, isVerificationCode } from '../auth/code';
import type { AuthFlow, AuthSession } from '../auth/contracts';
import { normalizePhone } from '../auth/phone';
import { clearPendingVerification, readPendingVerification, savePendingVerification } from '../auth/pending';
import { saveRegistrationProof, storeProof } from '../auth/proof';
import { clearReturnPath, readReturnPath, safeReturnPath } from '../auth/returnPath';
import { useSession } from '../auth/sessionContext';
import { AuthBack } from '../components/AuthBack';
import { Button } from '../components/Button';
import { ErrorMessage } from '../components/ErrorMessage';
import { Input } from '../components/Input';
import { ZimbabwePhoneField } from '../components/ZimbabwePhoneField';
import { Loading } from '../components/Loading';
import { Page } from '../components/Page';

const RESEND_COOLDOWN_MS = 60_000;
const ACCOUNT_NOT_FOUND = 'Account not found. Create an account to continue.';
const SIGN_IN_INSTEAD = 'This number already has an account. Sign in to continue.';

type VerificationFormProps = {
  flow: AuthFlow;
  title: string;
};

export function VerificationForm({ flow, title }: VerificationFormProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { status, saveSession } = useSession();
  const step = params.get('step') === 'code' ? 'code' : 'phone';
  const returnPath = safeReturnPath(fromState(location.state)) ?? readReturnPath();
  const notice = noticeFrom(location.state);

  useEffect(() => {
    if (status !== 'signed-in') {
      return;
    }
    clearReturnPath();
    navigate(returnPath ?? '/home', { replace: true });
  }, [navigate, returnPath, status]);

  if (status === 'loading') {
    return (
      <Page title={title}>
        <Loading label="Checking your session" />
      </Page>
    );
  }

  if (status === 'signed-in') {
    return (
      <Page title={title}>
        <Loading label="Opening your account" />
      </Page>
    );
  }

  if (step === 'code') {
    return <CodeStep flow={flow} title={title} returnPath={returnPath} onSession={saveSession} />;
  }

  return <PhoneStep flow={flow} title={title} notice={notice} />;
}

function PhoneStep({ flow, title, notice }: { flow: AuthFlow; title: string; notice: string | null }) {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isLoading) {
      return;
    }
    setError(null);
    let normalized = '';
    try {
      normalized = normalizePhone(phone);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enter a valid Zimbabwe mobile number.');
      return;
    }
    setIsLoading(true);
    try {
      if (flow === 'whatsapp_login') {
        const started = await startWhatsAppLogin(normalized);
        if (started.status === 'unavailable') {
          setError(ACCOUNT_NOT_FOUND);
          return;
        }
      } else {
        await startWhatsAppRegistration(normalized);
      }
      savePendingVerification({ flow, phone: normalized });
      navigate(flow === 'whatsapp_login' ? '/sign-in?step=code' : '/create-account?step=code', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification could not be started.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
    <AuthBack to="/" />
    <Page title={title}>
      <p className="lede">We will send a verification code on WhatsApp.</p>
      {notice ? <ErrorMessage>{notice}</ErrorMessage> : null}
      <form className="stack" onSubmit={(event) => { void submit(event); }}>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <ZimbabwePhoneField
          id={flow === 'whatsapp_login' ? 'sign-in-phone' : 'create-phone'}
          value={phone}
          onChange={setPhone}
          disabled={isLoading}
          required
        />
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Sending code' : 'Send code'}
        </Button>
      </form>
      {flow === 'whatsapp_login' ? (
        <Button to="/create-account" variant="outline">Create account</Button>
      ) : (
        <Button to="/sign-in" variant="outline">Sign in</Button>
      )}
    </Page>
    </>
  );
}

function CodeStep({
  flow,
  title,
  returnPath,
  onSession,
}: {
  flow: AuthFlow;
  title: string;
  returnPath: string | null;
  onSession: (session: AuthSession) => void;
}) {
  const navigate = useNavigate();
  const phone = readPendingVerification(flow);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resendAvailableAt, setResendAvailableAt] = useState(() => Date.now() + RESEND_COOLDOWN_MS);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!phone) {
    return (
      <>
        <AuthBack to={flow === 'whatsapp_login' ? '/sign-in' : '/create-account'} />
        <Page title={title}>
          <ErrorMessage>Request a new verification code.</ErrorMessage>
        </Page>
      </>
    );
  }

  const verifiedPhone = phone;
  const secondsRemaining = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isLoading) {
      return;
    }
    if (!isVerificationCode(code)) {
      setError('Enter the verification code sent to your phone.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = flow === 'whatsapp_login'
        ? await verifyWhatsAppLogin(verifiedPhone, code)
        : await verifyWhatsAppRegistration(verifiedPhone, code);
      if ('accessToken' in result) {
        clearPendingVerification();
        onSession(result);
        navigate(returnPath ?? '/home', { replace: true });
        return;
      }
      if (result.status === 'sign_in') {
        setError(SIGN_IN_INSTEAD);
        return;
      }
      const proof = storeProof(result.registrationToken, result.fullName ?? '', result.address ?? '');
      if (!proof) {
        setError('Verify your number again to finish creating the account.');
        return;
      }
      clearPendingVerification();
      saveRegistrationProof(proof);
      navigate('/create-account?step=details', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification failed.');
    } finally {
      setIsLoading(false);
    }
  }

  async function resend() {
    if (isLoading || secondsRemaining > 0) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      if (flow === 'whatsapp_login') {
        const started = await resendWhatsAppLogin(verifiedPhone);
        if (started.status === 'unavailable') {
          setError(ACCOUNT_NOT_FOUND);
          return;
        }
      } else {
        await resendWhatsAppRegistration(verifiedPhone);
      }
      setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A new code could not be sent.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
    <AuthBack to={flow === 'whatsapp_login' ? '/sign-in' : '/create-account'} />
    <Page title={title}>
      <p className="lede">Enter the WhatsApp code for {phone}.</p>
      <form className="stack" onSubmit={(event) => { void submit(event); }}>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        {error === SIGN_IN_INSTEAD ? <Link to="/sign-in">Go to sign in</Link> : null}
        <Input
          id={flow === 'whatsapp_login' ? 'sign-in-code' : 'create-code'}
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(fitOtpDigits(event.target.value))}
          disabled={isLoading}
          required
        />
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Checking code' : 'Verify code'}
        </Button>
      </form>
      <Button type="button" variant="secondary" disabled={isLoading || secondsRemaining > 0} onClick={() => { void resend(); }}>
        {secondsRemaining > 0 ? `Resend code in ${secondsRemaining}s` : 'Resend code'}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          clearPendingVerification();
          navigate(flow === 'whatsapp_login' ? '/sign-in' : '/create-account', { replace: true });
        }}
      >
        Use a different number
      </Button>
    </Page>
    </>
  );
}

function fromState(state: unknown): unknown {
  if (!state || typeof state !== 'object' || !('from' in state)) {
    return null;
  }
  return state.from;
}

function noticeFrom(state: unknown): string | null {
  if (!state || typeof state !== 'object' || !('notice' in state)) {
    return null;
  }
  return typeof state.notice === 'string' && state.notice.trim() ? state.notice.trim() : null;
}
