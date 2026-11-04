import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Page } from '../components/Page';
import { PlaceholderNote } from '../components/PlaceholderNote';

export function CreateAccountPage() {
  return (
    <div className="auth-screen">
      <Page title="Create account">
        <PlaceholderNote>
          Placeholder. Account creation is not connected yet. This screen does not create an account.
        </PlaceholderNote>
        <Input id="create-name" label="Full name" autoComplete="name" disabled />
        <Input id="create-phone" label="Phone number" type="tel" autoComplete="tel" disabled />
        <Button type="button" disabled>Continue</Button>
        <Button to="/" variant="secondary">Back to welcome</Button>
      </Page>
    </div>
  );
}
