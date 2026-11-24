import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import {
  SUCCESS_TOAST_DISMISS_MS,
  SUCCESS_TOAST_MOTION_MS,
  currentSuccessToast,
  dismissSuccessToast,
  subscribeSuccessToast,
  type SuccessToastEvent,
} from './successToast';

export function SuccessToastHost() {
  const toast = useSyncExternalStore(subscribeSuccessToast, currentSuccessToast, () => null);
  const [rendered, setRendered] = useState<SuccessToastEvent | null>(null);
  const [leaving, setLeaving] = useState(false);
  const shown = useRef<SuccessToastEvent | null>(null);
  const bannerOffset = useBannerOffset();

  useEffect(() => {
    if (toast) {
      shown.current = toast;
      setRendered(toast);
      setLeaving(false);
      return;
    }
    if (shown.current) setLeaving(true);
  }, [toast]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = toast.id;
    const timer = window.setTimeout(() => dismissSuccessToast(id), SUCCESS_TOAST_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => {
      shown.current = null;
      setRendered(null);
      setLeaving(false);
    }, SUCCESS_TOAST_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!rendered) return null;

  return (
    <div
      className={leaving ? 'success-toast-host is-leaving' : 'success-toast-host is-visible'}
      style={{ '--success-toast-banner-offset': `${bannerOffset}px` } as CSSProperties}
    >
      <div className="success-toast" role="status" aria-live="polite">
        <span className="success-toast-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M21 7 9 19l-5.5-5.5 1.41-1.41L9 16.17 19.59 5.59 21 7Z" fill="currentColor" /></svg>
        </span>
        <p>{rendered.message}</p>
      </div>
    </div>
  );
}

function useBannerOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    function measure() {
      const banners = [...document.querySelectorAll('.banner')];
      const height = banners.reduce((sum, node) => sum + (node instanceof HTMLElement ? node.offsetHeight : 0), 0);
      setOffset(Math.max(0, height - window.scrollY));
    }
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, []);
  return offset;
}
