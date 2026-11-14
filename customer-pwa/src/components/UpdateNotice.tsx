import { useEffect, useState } from 'react';
import { subscribeToAppUpdate } from '../pwa';

export function UpdateNotice() {
  const [reload, setReload] = useState<(() => void) | null>(null);

  useEffect(() => {
    return subscribeToAppUpdate((next) => setReload(() => next));
  }, []);

  if (!reload) {
    return null;
  }

  return (
    <div className="banner banner-update" role="status">
      <span>A new version of Riders is ready.</span>
      <button type="button" className="banner-update-refresh" onClick={reload}>
        Refresh
      </button>
    </div>
  );
}
