import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useShell } from './shell';
import { useFocusEffect } from 'expo-router';
import { onInboxChanged } from '../../modules/va-bridge';

const CACHE_PREFIX = 'cache:';
/** Only non-private list/summary views are cached locally for offline reading; individual chat threads (`contact:*`) are never cached. */
const isCacheable = (key: string): boolean =>
  key === 'overview' || key === 'assistant-config' || key === 'channels' || key.startsWith('tasks:') || key.startsWith('contacts:');

export async function clearOfflineCache(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM app_preferences WHERE key LIKE ?', [`${CACHE_PREFIX}%`]).catch(() => {});
}

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
  const db = useSQLiteContext();
  const always = !!opts?.always; // true for things that live outside a screen (the header, the problem banner)
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fails, setFails] = useState(0); // consecutive failed loads: a screen that HAD data can still be honest when the server goes away
  const hasDataRef = useRef(false);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  // Offline read-cache: immediately hydrate last-synced summary/list data so Home, Tasks & Inbox remain readable without internet.
  useEffect(() => {
    if (!isCacheable(queryKey)) return undefined;
    let active = true;
    void db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', [`${CACHE_PREFIX}${queryKey}`]).then((row) => {
      if (!active || !row?.value) return;
      try {
        const parsed = JSON.parse(row.value) as T;
        hasDataRef.current = true;
        setData((cur) => (cur === null ? parsed : cur));
        setLoading(false);
      } catch { /* ignore corrupt cache */ }
    }).catch(() => {});
    return () => { active = false; };
  }, [db, queryKey]);

  const run = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const fresh = await loadRef.current();
      hasDataRef.current = true;
      setData(fresh);
      setError(null);
      setFails(0);
      if (isCacheable(queryKey)) {
        void db.runAsync('INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)', [`${CACHE_PREFIX}${queryKey}`, JSON.stringify(fresh)]).catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'কিছু একটা সমস্যা হয়েছে');
      setFails((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }, [db, queryKey]);
  const tick = useShell((st) => st.tick);
  useEffect(() => {
    if (tick === 0) return undefined;
    const t = setTimeout(() => { void run(true); }, 0);
    return () => clearTimeout(t);
  }, [tick, run]);
  const live = useCallback(() => {
    const first = setTimeout(() => { void run(hasDataRef.current); }, 0); // instant tab switches: quiet refresh when data is already on screen
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
  return { data, error, loading, fails, reload: () => run(), setData };
}
