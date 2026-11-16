import { useEffect, useRef, useState } from 'react';
import { subscribeToAppUpdate } from '../pwa';

export function UpdateNotice() {
  const [reload, setReload] = useState<(() => void) | null>(null);
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);

  function handleRefresh() {
    if (processingRef.current || !reload) return;
    processingRef.current = true;
    setProcessing(true);
    reload();
  }

  useEffect(() => {
    return subscribeToAppUpdate((next) => setReload(() => next));
  }, []);

  if (!reload) {
    return null;
  }

  return (
    <div className="banner banner-update" role="status">
      <span>A new version of Riders is ready.</span>
      <button type="button" className="banner-update-refresh" onClick={handleRefresh} disabled={processing}>
        Refresh
      </button>
    </div>
  );
}
