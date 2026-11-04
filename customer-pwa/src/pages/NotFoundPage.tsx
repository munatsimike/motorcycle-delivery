import { Button } from '../components/Button';
import { Page } from '../components/Page';

export function NotFoundPage() {
  return (
    <div className="auth-screen">
      <Page title="Page not found">
        <p className="lede">That address is not part of Riders.</p>
        <Button to="/">Go to welcome</Button>
      </Page>
    </div>
  );
}
