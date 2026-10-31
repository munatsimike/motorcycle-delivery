import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { CustomersPage } from './pages/CustomersPage';
import { DeliveryPage } from './pages/DeliveryPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { MotorcyclesPage } from './pages/MotorcyclesPage';
import { OverviewPage } from './pages/OverviewPage';
import { RiderPage } from './pages/RiderPage';
import { RidersPage } from './pages/RidersPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import { VerifyPage } from './pages/VerifyPage';
import { Shell } from './shell';
import { Loading } from './ui';

export function App() {
  const auth = useAuth();
  if (!auth.ready) {
    return <Loading label="Checking your session" />;
  }
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route element={auth.signedIn ? <Shell /> : <Navigate to="/sign-in" replace />}>
        <Route index element={<OverviewPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="riders" element={<RidersPage />} />
        <Route path="riders/:riderProfileId" element={<RiderPage />} />
        <Route path="motorcycles" element={<MotorcyclesPage />} />
        <Route path="deliveries" element={<DeliveriesPage />} />
        <Route path="deliveries/:deliveryId" element={<DeliveryPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={auth.signedIn ? '/' : '/sign-in'} replace />} />
    </Routes>
  );
}
