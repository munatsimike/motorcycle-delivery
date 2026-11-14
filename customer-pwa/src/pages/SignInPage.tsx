import { VerificationForm } from './VerificationForm';

export function SignInPage() {
  return (
    <div className="auth-screen page-stage is-entering">
      <VerificationForm flow="whatsapp_login" title="Sign in" />
    </div>
  );
}
