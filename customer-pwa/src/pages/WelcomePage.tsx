import motorcycle from '../assets/riders-motorcycle.png';
import { BrandLogo } from '../components/BrandLogo';
import { Button } from '../components/Button';

export function WelcomePage() {
  return (
    <main id="main" className="welcome page-stage is-entering">
      <div className="welcome-stage">
        <div className="welcome-logo">
          <BrandLogo />
        </div>
        <div className="welcome-hero">
          <img src={motorcycle} alt="" width={229} height={217} />
          <div className="welcome-fade" aria-hidden="true" />
        </div>
        <div className="welcome-card">
          <section className="welcome-panel">
            <h1>Fast, Safe, and Always<br />On Time</h1>
            <p className="lede">Trusted motorcycle deliveries for quick and secure parcel transport.</p>
            <div className="welcome-actions">
              <Button to="/sign-in">Sign in</Button>
              <Button to="/create-account" variant="outline">Create account</Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
