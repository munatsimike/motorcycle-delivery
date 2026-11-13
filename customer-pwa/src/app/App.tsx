import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { OfflineNotice } from '../components/OfflineNotice';
import { UpdateNotice } from '../components/UpdateNotice';
import { Loading } from '../components/Loading';
import { BookPage } from '../pages/BookPage';
import { HomePage } from '../pages/HomePage';
import { CreateAccountPage } from '../pages/CreateAccountPage';
import { DeliveriesPage } from '../pages/DeliveriesPage';
import { DeliveryDetailsPage } from '../pages/DeliveryDetailsPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ProfilePage } from '../pages/ProfilePage';
import { SignInPage } from '../pages/SignInPage';
import { WelcomePage } from '../pages/WelcomePage';
import { useSession } from '../auth/sessionContext';
import { clearReturnPath, readReturnPath, rememberReturnPath } from '../auth/returnPath';
import { signedOutDestination, visibleTree } from './navigation';
import { Shell } from './Shell';

export function App() {
  const { status } = useSession();

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <OfflineNotice />
      <UpdateNotice />
      {visibleTree(status) === 'session-check' ? <SessionCheck /> : status === 'signed-in' ? <SignedInRoutes /> : <SignedOutRoutes />}
    </>
  );
}

function SessionCheck() {
  return (
    <div className="auth-screen">
      <Loading label="Checking your session" />
    </div>
  );
}

function SignedOutRoutes() {
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/create-account" element={<CreateAccountPage />} />
      <Route path="*" element={<SignedOutFallback />} />
    </Routes>
  );
}

function SignedOutFallback() {
  const location = useLocation();
  const destination = signedOutDestination(location.pathname);
  if (destination) {
    rememberReturnPath(location.pathname);
    return <Navigate to={destination} replace state={{ from: location.pathname }} />;
  }
  return <NotFoundPage />;
}

function SignedInRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SignedInHomeRedirect />} />
      <Route path="/sign-in" element={<SignedInHomeRedirect />} />
      <Route path="/create-account" element={<SignedInHomeRedirect />} />
      <Route element={<Shell />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/deliveries" element={<DeliveriesPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="/book" element={<><ConsumedReturnPath /><BookPage /></>} />
      <Route path="/deliveries/:id" element={<><ConsumedReturnPath /><DeliveryDetailsPage /></>} />
      <Route path="*" element={<NotFoundPage home />} />
    </Routes>
  );
}

function SignedInHomeRedirect() {
  const location = useLocation();
  const leaving = isLeavingAccount(location.state);
  const returnPath = readReturnPath() ?? '/home';
  useEffect(() => {
    if (!leaving) {
      clearReturnPath();
    }
  }, [leaving]);
  if (leaving) {
    return (
      <div className="auth-screen">
        <Loading label="Signing out" />
      </div>
    );
  }
  return <Navigate to={returnPath} replace />;
}

function ConsumedReturnPath() {
  const location = useLocation();
  useEffect(() => {
    const stored = readReturnPath();
    if (stored && location.pathname === stored) clearReturnPath();
  }, [location.pathname]);
  return null;
}

function isLeavingAccount(state: unknown): boolean {
  return Boolean(state && typeof state === 'object' && 'leftAccount' in state && state.leftAccount === true);
}
