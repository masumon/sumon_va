// Shadows expo-router's built-in `/_sitemap` development screen.
//
// That screen renders a `SystemInfo` block which reads `window.location.origin`. There is
// no `window.location` on a phone, so in a release build the route does not merely look
// wrong — it throws `Cannot read property 'origin' of undefined` on the JS thread, kills
// the process, and drops the user back at the launcher. The app's own error boundary never
// sees it, because the failure happens while the route tree is rendering.
//
// The route is reachable in production: expo-router's default "Unmatched" screen links
// straight to it, so any stale `apon://` link was two taps from a crash. That screen is
// replaced by `+not-found.tsx`, and this file closes the direct path — a developer route
// has no business in a build people actually use, and the honest thing to do with it is
// send the visitor somewhere real.

import { Redirect } from 'expo-router';

export default function SitemapDisabled() {
  return <Redirect href="/" />;
}
