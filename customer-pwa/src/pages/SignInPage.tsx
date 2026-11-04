import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Page } from '../components/Page';
import { PlaceholderNote } from '../components/PlaceholderNote';

export function SignInPage() {
  return (
    <div className="auth-screen">
      <Page title="Sign in">
        <PlaceholderNote>
          Placeholder. Phone verification is not connected yet. This screen does not sign you in.
        </PlaceholderNote>
        <Input id="sign-in-phone" label="Phone number" type="tel" autoComplete="tel" disabled />
        <Button type="button" disabled>Send code</Button>
        <Button to="/" variant="secondary">Back to welcome</Button>
      </Page>
    </div>
  );
}
