import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useShell } from './shell';
import { useFocusEffect } from 'expo-router';
import { onInboxChanged } from '../../modules/va-bridge';

/** True while the app is in the foreground. Every timer and endless animation checks this so nothing runs in the background. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/** Cheap structural compare (objects and arrays) so a repeated, unchanged bridge status does not re-render anything. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/**
 * Loads once when a screen comes into view, then (optionally) keeps it fresh while it stays in view. One place for every screen.
 * `queryKey` says "this is a different question" (e.g. another filter or person): a new key reloads.
 */
export function useLoad<T>(load: () => Promise<T>, queryKey: string, everyMs?: number, opts?: { always?: boolean }) {
  const always = !!opts?.always; // true for things that live outside a screen (the header, the problem banner)
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
  const tick = useShell((st) => st.tick);
  useEffect(() => {
    if (tick === 0) return undefined;
    const t = setTimeout(() => { void run(true); }, 0);
    return () => clearTimeout(t);
  }, [tick, run]);
  const live = useCallback(() => {
    const first = setTimeout(() => { void run(); }, 0); // started after the effect, not inside it
    if (!everyMs) return () => clearTimeout(first);
    // No timed refresh while the app is in the background; one quiet refresh when it comes back.
    const id = setInterval(() => { if (AppState.currentState === 'active') void run(true); }, everyMs);
    const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') void run(true); });
    // Real time: the phone service tells us the instant something changed, so the screen updates without waiting for the timer.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const off = onInboxChanged(() => { if (pending) clearTimeout(pending); pending = setTimeout(() => { void run(true); }, 300); });
    return () => { clearTimeout(first); clearInterval(id); appSub.remove(); off(); if (pending) clearTimeout(pending); };
  }, [run, everyMs]);
  useEffect(() => (always ? live() : undefined), [always, live]);
  useFocusEffect(useCallback(() => (always ? undefined : live()), [always, live]));
  return { data, error, loading, reload: () => run(), setData };
}
