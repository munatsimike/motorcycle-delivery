import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { completeWhatsAppRegistration } from '../auth/api';
import { ApiError } from '../api/client';
import {
  collapseRegistrationName,
  registrationDetailsIssue,
  registrationNameFieldError,
} from '../auth/name';
import { clearRegistrationProof, readRegistrationProof, saveRegistrationProof, verifiedRegistrationPhone } from '../auth/proof';
import { readReturnPath, safeReturnPath } from '../auth/returnPath';
import { useSession } from '../auth/sessionContext';
import { VerificationForm } from './VerificationForm';
import { AuthBack } from '../components/AuthBack';
import { Button } from '../components/Button';
import { ErrorMessage } from '../components/ErrorMessage';
import { Input } from '../components/Input';
import { Page } from '../components/Page';

export function CreateAccountPage() {
  const [params] = useSearchParams();
  if (params.get('step') === 'details') {
    return <RegistrationDetails />;
  }
  return (
    <div className="auth-screen page-stage is-entering">
      <VerificationForm flow="whatsapp_registration" title="Create account" />
    </div>
  );
}

function RegistrationDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const { saveSession } = useSession();
  const proof = readRegistrationProof();
  const [fullName, setFullName] = useState(proof?.fullName ?? '');
  const [address, setAddress] = useState(proof?.address ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const phone = proof ? verifiedRegistrationPhone(proof.registrationToken) : null;

  if (!proof) {
    return (
      <div className="auth-screen page-stage is-entering">
        <AuthBack to="/" />
        <Page title="Create account">
          <ErrorMessage>Verify your number again to finish creating the account.</ErrorMessage>
          <Button to="/create-account" variant="secondary">Start again</Button>
        </Page>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isLoading || !proof) {
      return;
    }
    const issue = registrationDetailsIssue(fullName, address);
    if (issue) {
      setError(issue);
      return;
    }
    const name = collapseRegistrationName(fullName);
    const place = address.trim().replace(/\s+/g, ' ');
    saveRegistrationProof({ ...proof, fullName: name, address: place });
    setIsLoading(true);
    setError(null);
    try {
      const session = await completeWhatsAppRegistration({
        registrationToken: proof.registrationToken,
        fullName: name,
        address: place,
      });
      clearRegistrationProof();
      saveSession(session);
      const destination = safeReturnPath(fromState(location.state)) ?? readReturnPath() ?? '/home';
      navigate(destination, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        clearRegistrationProof();
        setError('Verify your number again to finish creating the account.');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Registration could not be finished.');
    } finally {
      setIsLoading(false);
    }
  }

  const nameError = registrationNameFieldError(error);

  return (
    <div className="auth-screen page-stage is-entering">
      <AuthBack to="/create-account" />
      <Page title="Your details">
        <p className="lede">Your number is verified. Add the details for this customer account.</p>
        {phone ? <p className="note">Verified mobile number {phone}</p> : null}
        <form className="stack" onSubmit={(event) => { void submit(event); }}>
          {error && error !== nameError ? <ErrorMessage>{error}</ErrorMessage> : null}
          <Input
            id="create-name"
            label="Full name"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            disabled={isLoading}
            required
          />
          {nameError ? <ErrorMessage>{nameError}</ErrorMessage> : null}
          <label className="field" htmlFor="create-address">
            Address
            <textarea
              id="create-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={isLoading}
              required
              rows={3}
            />
          </label>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Creating account' : 'Create account'}
          </Button>
        </form>
      </Page>
    </div>
  );
}

function fromState(state: unknown): unknown {
  if (!state || typeof state !== 'object' || !('from' in state)) {
    return null;
  }
  return state.from;
}
