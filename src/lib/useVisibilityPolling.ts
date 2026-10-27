import { useEffect, useRef } from 'react';

type PollCallback = () => void | Promise<void>;

/** Runs one request at a time and pauses network work while the page is hidden. */
export function useVisibilityPolling(callback: PollCallback, intervalMs: number, enabled = true) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (!disposed && document.visibilityState === 'visible') {
        timer = setTimeout(() => void run(), intervalMs);
      }
    };

    const run = async () => {
      if (disposed || running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        await callbackRef.current();
      } catch (error) {
        console.error('Background refresh failed', error);
      } finally {
        running = false;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState === 'visible') void run();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void run();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
