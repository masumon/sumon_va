import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getStatus, startService } from '../../modules/va-bridge';
import { useShell } from './shell';

/**
 * Opening the app (or coming back to it) syncs by itself: the background service is started if the phone had stopped it,
 * and every open screen reloads. It says nothing: the header's sync light (green / red / spinning) shows how it went. Renders nothing.
 */
export function AutoSync() {
  const last = useRef(0);

  useEffect(() => {
    const sync = () => {
      const now = Date.now();
      if (now - last.current < 15_000) return; // opening and closing quickly must not spam the server
      last.current = now;
      const before = getStatus();
      if (!before.paired) return;
      if (!before.serviceAlive) startService();
      useShell.getState().refresh();
      // Silent on purpose: the header light shows how sync is doing; a toast on every opening only annoyed.
    };
    sync();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') sync(); });
    return () => sub.remove();
  }, []);

  return null;
}
