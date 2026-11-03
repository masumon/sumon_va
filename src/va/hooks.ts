import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { onInboxChanged } from '../../modules/va-bridge';

/**
 * Loads once when a screen comes into view, then (optionally) keeps it fresh while it stays in view. One place for every screen.
 * `queryKey` says "this is a different question" (e.g. another filter or person): a new key reloads.
 */
export function useLoad<T>(load: () => Promise<T>, queryKey: string, everyMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const run = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'কিছু একটা সমস্যা হয়েছে');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);
  useFocusEffect(useCallback(() => {
    void run();
    if (!everyMs) return undefined;
    const id = setInterval(() => { void run(true); }, everyMs);
    // Real time: the phone service tells us the instant something changed, so the screen updates without waiting for the timer.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const off = onInboxChanged(() => { if (pending) clearTimeout(pending); pending = setTimeout(() => { void run(true); }, 300); });
    return () => { clearInterval(id); off(); if (pending) clearTimeout(pending); };
  }, [run, everyMs]));
  return { data, error, loading, reload: () => run(), setData };
}
