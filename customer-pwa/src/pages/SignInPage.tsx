import { VerificationForm } from './VerificationForm';

export function SignInPage() {
  return (
    <div className="auth-screen">
      <VerificationForm flow="whatsapp_login" title="Sign in" />
    </div>
  );
}
