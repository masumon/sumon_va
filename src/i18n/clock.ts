// Wall-clock times, as stored and as read.
//
// A dose time, a visit time and a task's due time are all bare `HH:MM` strings with no
// date and no zone behind them. That is deliberate — "সকাল ৮টা" means eight in the morning
// on whichever day the dose falls, not one fixed instant — and it is also why none of this
// goes through `Intl`: handing it a synthetic Date would re-read these through the app's
// timezone and shift the very number the user typed.
//
// Kept out of the picker component so the rules can be tested without a native runtime.

import { asciiDigitsToBengali } from '../services/debt/money';

export type TimeFormat = '12' | '24';

/** True only for a real wall-clock time — "25:00" and "08:70" are both rejected. */
export function isValidClock(value: string | null | undefined): boolean {
  if (!value || !/^\d{1,2}:\d{2}$/u.test(value)) return false;
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** `HH:MM`, always two digits, so stored times sort and compare as strings. */
export function toClock(hour: number, minute: number): string {
  return `${String(((hour % 24) + 24) % 24).padStart(2, '0')}:${String(((minute % 60) + 60) % 60).padStart(2, '0')}`;
}

/**
 * A stored `HH:MM` as the reader has asked to see it.
 *
 * Deliberately not routed through `Intl`: these are bare wall-clock strings with no date
 * and no zone behind them, and handing `Intl` a synthetic Date would re-read them through
 * the app's timezone and shift the very number the user typed. AM/PM stays Latin in both
 * languages, matching how Settings already prints its quiet-hours row.
 */
export function formatClock(value: string | null | undefined, bn: boolean, mode: TimeFormat): string {
  if (!isValidClock(value)) return value ?? '';
  const [h, m] = value!.split(':').map(Number) as [number, number];
  const digits = (v: string) => (bn ? asciiDigitsToBengali(v) : v);
  if (mode === '24') return digits(toClock(h, m));
  const hour12 = h % 12 || 12;
  return `${digits(String(hour12))}:${digits(String(m).padStart(2, '0'))} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "সকাল" / "দুপুর" / "সন্ধ্যা" / "রাত" for a clock time — the part of day it lands in. */
export function partOfDay(value: string | null | undefined, bn: boolean): string {
  if (!isValidClock(value)) return '';
  const h = Number(value!.split(':')[0]);
  if (h < 12) return bn ? 'সকাল' : 'Morning';
  if (h < 16) return bn ? 'দুপুর' : 'Noon';
  if (h < 19) return bn ? 'সন্ধ্যা' : 'Evening';
  return bn ? 'রাত' : 'Night';
}
