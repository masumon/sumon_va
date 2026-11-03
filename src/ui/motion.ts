import { LayoutAnimation } from 'react-native';

/**
 * UX-01: a form that opens inside the page (Health's add forms) eases in and out, the way
 * every other module's form slides in as its own screen — instead of jumping into place.
 * Respects "reduce motion".
 */
export function easeNextLayout(reduceMotion: boolean): void {
  if (reduceMotion) return;
  try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch { /* no layout animation on this platform */ }
}
