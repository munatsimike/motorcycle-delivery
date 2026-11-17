import { AuthScreen } from '../components/AuthScreen';
import { VerificationForm } from './VerificationForm';

export function SignInPage() {
  return (
    <AuthScreen>
      <VerificationForm flow="whatsapp_login" title="Sign in" />
    </AuthScreen>
  );
}
