import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppPreferences } from '../app/AppPreferences';
import { useAppFeedback } from '../ui/AppFeedback';
import { getStatus, startService } from '../../modules/va-bridge';
import { useShell } from './shell';

/**
 * Opening the app (or coming back to it) syncs by itself: the background service is started if the phone had stopped it,
 * every open screen reloads, and a small toast says how it went. If it went badly the toast says why and where to fix it
 * (the red/amber strip under the header carries the same reason and a button to the fix). Renders nothing.
 */
export function AutoSync() {
  const { language } = useAppPreferences();
  const { showSnackbar } = useAppFeedback();
  const bn = language === 'bn';
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
      setTimeout(() => {
        const s = getStatus();
        const t = Date.now();
        // One failed try (the free server waking up, a network switch) fixes itself in seconds: only a lasting problem is shown.
        const lasting = !!s.lastError && (!s.lastOk || t - s.lastOk > 90_000);
        const fresh = !!s.lastOk && t - s.lastOk < 60_000;
        if (!s.serviceAlive) showSnackbar(bn ? 'সিঙ্ক চালু হয়নি। ফোন অ্যাপটা থামিয়ে রেখেছে। ওপরের লাল স্ট্রিপে চাপ দিয়ে ঠিক করুন।' : 'Sync did not start: the phone stopped the app. Tap the red strip above to fix it.', 'danger');
        else if (lasting) showSnackbar(bn ? `সিঙ্কে সমস্যা: ${s.lastError}। “মাধ্যম” বা ওপরের স্ট্রিপ থেকে কারণ দেখুন।` : `Sync problem: ${s.lastError}. See the strip above for the reason.`, 'danger');
        else if (s.queued > 0) showSnackbar(bn ? `${s.queued}টি বার্তা পাঠানো বাকি। ইন্টারনেট এলে চলে যাবে।` : `${s.queued} messages will upload when the internet returns.`, 'info');
        else if (fresh) showSnackbar(bn ? 'সিঙ্ক হয়েছে' : 'Synced', 'success'); // never claim "synced" when it was not
      }, 2500);
    };
    sync();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') sync(); });
    return () => sub.remove();
  }, [bn, showSnackbar]);

  return null;
}
