import { useEffect, useState } from 'react';

export function OfflineNotice() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    function onOnline() {
      setOnline(true);
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) {
    return null;
  }

  return (
    <div className="banner banner-offline" role="status">
      You are offline. Booking and account actions need a connection.
    </div>
  );
}
