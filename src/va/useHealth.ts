import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getStatus } from '../../modules/va-bridge';
import { clearApiCache, va } from './api';
import { computeIssues } from './health';
import { sameValue, useLoad } from './hooks';

/** Live health of the whole app. Re-checks every 15–60 s, the moment the phone service reports a change, and when the header's refresh is pressed. */
export function useHealth() {
  const overview = useLoad(() => va.overview(), 'health-overview', 15000, { always: true });
  const channels = useLoad(() => va.channels(), 'health-channels', 45000, { always: true });
  const hub = useLoad(() => va.aiHub(), 'health-hub', 60000, { always: true });
  const [bridge, setBridge] = useState(getStatus());
  const [now, setNow] = useState(() => Date.now());
  const ticks = useRef(0);
  useEffect(() => {
    // Only touches state when something really changed; `now` moves every ~15 s (the thresholds are 90 s and 5 min). Paused in the background.
    const check = () => {
      if (AppState.currentState !== 'active') return;
      ticks.current += 1;
      const next = getStatus();
      setBridge((prev) => (sameValue(prev, next) ? prev : next));
      if (ticks.current % 5 === 0) setNow(Date.now());
    };
    const id = setInterval(check, 3000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      const next = getStatus();
      setBridge((prev) => (sameValue(prev, next) ? prev : next));
      setNow(Date.now());
    });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  // after two failed checks in a row, old data no longer hides a server outage
  const issues = useMemo(() => computeIssues({ bridge, overview: overview.data, overviewError: !overview.data || overview.fails >= 2 ? overview.error : null, channels: channels.data, hub: hub.data, now }),
    [bridge, overview.data, overview.error, overview.fails, channels.data, hub.data, now]);
  const reload = () => { clearApiCache(); void overview.reload(); void channels.reload(); void hub.reload(); setBridge(getStatus()); };
  return { issues, reload, bridge, loading: overview.loading && !overview.data };
}
