import { BrandMark } from '../components/BrandMark';
import { Button } from '../components/Button';
import { Page } from '../components/Page';

export function WelcomePage() {
  return (
    <div className="auth-screen">
      <Page title="Motorcycle delivery">
        <BrandMark />
        <p className="lede">Send parcels with Riders. Sign in, create an account, or continue as a guest when that path is ready.</p>
        <Button to="/book">Continue as guest</Button>
        <Button to="/create-account">Create account</Button>
        <Button to="/sign-in" variant="secondary">Sign in</Button>
      </Page>
    </div>
  );
}
