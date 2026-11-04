import { Navigate, Route, Routes } from 'react-router-dom';
import { OfflineNotice } from '../components/OfflineNotice';
import { UpdateNotice } from '../components/UpdateNotice';
import { BookPage } from '../pages/BookPage';
import { CreateAccountPage } from '../pages/CreateAccountPage';
import { DeliveriesPage } from '../pages/DeliveriesPage';
import { DeliveryDetailsPage } from '../pages/DeliveryDetailsPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ProfilePage } from '../pages/ProfilePage';
import { SignInPage } from '../pages/SignInPage';
import { WelcomePage } from '../pages/WelcomePage';
import { Shell } from './Shell';

export function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <OfflineNotice />
      <UpdateNotice />
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/create-account" element={<CreateAccountPage />} />
        <Route element={<Shell />}>
          <Route path="/book" element={<BookPage />} />
          <Route path="/deliveries" element={<DeliveriesPage />} />
          <Route path="/deliveries/:id" element={<DeliveryDetailsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
