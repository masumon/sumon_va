import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

// Editors pass a live `dirty` flag. While dirty, the Android hardware back is intercepted
// and `confirming` flips true (the screen renders its own confirm dialog off that). In-screen
// back / cancel buttons call `attemptLeave(leave)` instead of leaving directly, so every exit
// path funnels through the same "discard changes?" gate. Not dirty → everything passes through.
export function useUnsavedGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onBack = () => {
      if (dirtyRef.current) { setConfirming(true); return true; }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, []);

  const attemptLeave = useCallback((leave: () => void) => {
    if (dirtyRef.current) setConfirming(true);
    else leave();
  }, []);

  return { confirming, setConfirming, attemptLeave };
}
