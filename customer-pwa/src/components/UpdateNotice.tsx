import { useEffect, useState } from 'react';
import { subscribeToAppUpdate } from '../pwa';
import { Button } from './Button';

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
      <Button type="button" onClick={reload}>
        Refresh
      </Button>
    </div>
  );
}
