import { Button } from '../components/Button';
import { Page } from '../components/Page';

export function NotFoundPage({ home = false }: { home?: boolean }) {
  return (
    <div className="auth-screen">
      <Page title="Page not found">
        <p className="lede">That address is not part of Riders.</p>
        <Button to={home ? '/home' : '/'}>{home ? 'Go to home' : 'Go to welcome'}</Button>
      </Page>
    </div>
  );
}
