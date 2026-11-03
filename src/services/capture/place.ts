// Where something happened.
//
// A place is one of the shared foundations, like a person or an amount: a memory has one,
// a trip has one, an expense has one. So it lives here and not inside any single module,
// and it is stored the way it will still be readable in ten years — two numbers plus the
// words the phone gave back at the time, never a handle into a map service.
//
// The reading is taken at the instant the user taps, in the foreground, once. Nothing is
// tracked, and a refused permission returns a plain result rather than an error, because
// declining to say where you are is a normal answer.

import * as Location from 'expo-location';

export interface Place {
  /** Degrees, as the phone reported them. */
  latitude: number;
  longitude: number;
  /** What the phone called the spot when it was captured — kept verbatim, never re-fetched. */
  label: string | null;
  capturedAt: string;
}

export type PlaceResult =
  | { status: 'captured'; place: Place }
  | { status: 'denied' }
  | { status: 'unavailable' };

/**
 * Google's geocoder often answers with a Plus Code ("R5V8+WF5") as the place's "name" when
 * the spot has no shop or street name — a code, not a name (rc.6 QA). Those parts are
 * dropped, and the area name that follows is used instead.
 */
const PLUS_CODE = /^(?:[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3})$/iu;
const isPlusCode = (part: string) => PLUS_CODE.test(part.trim());

/** A saved label without Plus Codes — also cleans labels saved before this fix. */
export function cleanPlaceLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const kept = label.split(',').map((p) => p.trim()).filter((p) => p && !isPlusCode(p));
  return kept.length ? kept.join(', ') : null;
}

/** Round to roughly a hundred metres. A memory does not need to know which room. */
const coarse = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Read the current place once.
 *
 * `ask` is true only when a screen has already shown the user why. Everything else passes
 * false, so a background path can find out whether a place is available without a dialog
 * appearing over whatever the user was reading.
 */
export async function capturePlace(ask = true): Promise<PlaceResult> {
  try {
    let granted = (await Location.getForegroundPermissionsAsync()).granted;
    if (!granted) {
      if (!ask) return { status: 'denied' };
      granted = (await Location.requestForegroundPermissionsAsync()).granted;
    }
    if (!granted) return { status: 'denied' };

    const withTimeout = <T,>(work: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

    let reading = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      12000,
    );
    if (!reading) reading = await withTimeout(Location.getLastKnownPositionAsync(), 3000);
    if (!reading) return { status: 'unavailable' };
    const latitude = coarse(reading.coords.latitude);
    const longitude = coarse(reading.coords.longitude);

    // The name is a nicety. If the phone has no geocoder — which is common offline — the
    // coordinates alone are still a perfectly good record of where you were.
    let label: string | null = null;
    try {
      const [found] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (found) {
        label = [found.name, found.street, found.district, found.city ?? found.subregion, found.region]
          .filter((part): part is string => Boolean(part && part.trim()) && !isPlusCode(part!))
          .filter((part, index, all) => all.indexOf(part) === index)
          .slice(0, 3)
          .join(', ') || null;
      }
    } catch {
      label = null;
    }

    return { status: 'captured', place: { latitude, longitude, label, capturedAt: new Date().toISOString() } };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * How a place reads on a card: its name, never numbers. Coordinates mean nothing to the
 * people this app is for (the user's rule, RC.4), so a spot the phone could not name says
 * so plainly and the screen offers to name it.
 */
export function describePlace(place: Place, language: 'bn' | 'en' = 'bn'): string {
  const clean = cleanPlaceLabel(place.label);
  if (clean) return clean;
  return language === 'bn' ? 'নাম ছাড়া জায়গা' : 'Unnamed place';
}

/** Store a place as one text column, so no module needs its own two extra columns. */
export const encodePlace = (place: Place): string => JSON.stringify(place);

export function decodePlace(raw: string | null | undefined): Place | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Place>;
    if (typeof parsed.latitude !== 'number' || typeof parsed.longitude !== 'number') return null;
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      label: typeof parsed.label === 'string' ? parsed.label : null,
      capturedAt: typeof parsed.capturedAt === 'string' ? parsed.capturedAt : '',
    };
  } catch {
    return null;
  }
}
