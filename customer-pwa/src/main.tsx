import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { SessionProvider } from './auth/SessionProvider';
import { AppearanceProvider } from './theme/AppearanceProvider';
import './pwa';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppearanceProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </AppearanceProvider>
    </BrowserRouter>
  </StrictMode>,
);
