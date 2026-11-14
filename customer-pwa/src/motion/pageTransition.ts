import { flushSync } from 'react-dom';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

export function beginPageTransition(update: () => void) {
  const viewDocument = document as ViewTransitionDocument;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !viewDocument.startViewTransition) {
    update();
    return;
  }
  document.documentElement.classList.add('is-page-transition');
  const transition = viewDocument.startViewTransition(() => {
    flushSync(update);
  });
  transition.finished.finally(() => {
    document.documentElement.classList.remove('is-page-transition');
  });
}

export function samePageLink(url: URL): boolean {
  return url.origin === window.location.origin
    && url.pathname === window.location.pathname
    && url.search === window.location.search;
}
