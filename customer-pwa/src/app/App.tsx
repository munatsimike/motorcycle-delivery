import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beginPageTransition, samePageLink } from '../motion/pageTransition';
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
      <PageTransitionLinks />
      <OfflineNotice />
      <UpdateNotice />
      {visibleTree(status) === 'session-check' ? <SessionCheck /> : status === 'signed-in' ? <SignedInRoutes /> : <SignedOutRoutes />}
    </>
  );
}

function PageTransitionLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || samePageLink(url)) return;
      event.preventDefault();
      event.stopPropagation();
      beginPageTransition(() => navigate(`${url.pathname}${url.search}${url.hash}`));
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);
  return null;
}

function SessionCheck() {
  return (
    <div className="auth-screen page-stage is-entering">
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
      <div className="auth-screen page-stage is-entering">
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
