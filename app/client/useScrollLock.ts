import { useEffect } from 'react';
let locks = 0,
  original = '';
// Readers and nested dialogs release only their own lock, including simultaneous unmounts.
export function useScrollLock() {
  useEffect(() => {
    if (locks++ === 0) original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      if (--locks === 0) document.body.style.overflow = original;
    };
  }, []);
}
