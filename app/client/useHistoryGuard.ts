import { useEffect } from 'react';
export type HistoryCheck = { dirty: boolean; busy: boolean; close: (() => void)[] };
export function useHistoryGuard(dirty: boolean, busy: boolean, onClose: () => void) {
  useEffect(() => {
    const handler = (event: Event) => {
      const data = (event as CustomEvent<HistoryCheck>).detail;
      data.dirty ||= dirty;
      data.busy ||= busy;
      data.close.push(onClose);
    };
    window.addEventListener('pk-history-check', handler);
    return () => window.removeEventListener('pk-history-check', handler);
  }, [dirty, busy, onClose]);
}
