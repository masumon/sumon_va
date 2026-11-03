import { useEffect, useMemo, useState } from 'react';
import { getStatus } from '../../modules/va-bridge';
import { va } from './api';
import { computeIssues } from './health';
import { useLoad } from './hooks';

/** Live health of the whole app. Re-checks every 15–60 s, the moment the phone service reports a change, and when the header's refresh is pressed. */
export function useHealth() {
  const overview = useLoad(() => va.overview(), 'health-overview', 15000, { always: true });
  const channels = useLoad(() => va.channels(), 'health-channels', 45000, { always: true });
  const hub = useLoad(() => va.aiHub(), 'health-hub', 60000, { always: true });
  const [bridge, setBridge] = useState(getStatus());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { setBridge(getStatus()); setNow(Date.now()); }, 3000);
    return () => clearInterval(id);
  }, []);
  const issues = useMemo(() => computeIssues({ bridge, overview: overview.data, overviewError: overview.data ? null : overview.error, channels: channels.data, hub: hub.data, now }),
    [bridge, overview.data, overview.error, channels.data, hub.data, now]);
  const reload = () => { void overview.reload(); void channels.reload(); void hub.reload(); setBridge(getStatus()); };
  return { issues, reload, bridge, loading: overview.loading && !overview.data };
}
