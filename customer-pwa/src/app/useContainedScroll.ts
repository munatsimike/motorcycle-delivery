import { useLayoutEffect, useRef } from 'react';

// A scroll container with overflow:auto still receives touch gestures when its
// content fits. Only mark it scrollable once the content is actually taller.
export function useContainedScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const update = () => {
      const overflows = node.scrollHeight - node.clientHeight > 1;
      const next = overflows ? 'true' : 'false';
      if (node.dataset.overflows !== next) node.dataset.overflows = next;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    const mutation = new MutationObserver(update);
    mutation.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, []);

  return ref;
}
