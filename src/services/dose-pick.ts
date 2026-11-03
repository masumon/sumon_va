import type { Dose } from './health-service';
import { formatBangladeshTime } from '../i18n/date-time';

// Kept apart from app-query-service so it stays a pure function of its inputs.

const TIME_OF_DAY: [RegExp, number, number][] = [
  [/সকাল|morning/iu, 4, 11], [/দুপুর|noon|afternoon/iu, 11, 16], [/বিকাল|বিকেল/iu, 15, 18],
  [/সন্ধ্যা|evening/iu, 17, 21], [/রাত|night/iu, 19, 28],
];

function doseHour(dose: Dose): number {
  const [h] = formatBangladeshTime(dose.dueAt, 'en').match(/\d+/u) ?? ['0'];
  const pm = /pm/iu.test(formatBangladeshTime(dose.dueAt, 'en'));
  const hour = Number(h) % 12 + (pm ? 12 : 0);
  return hour < 4 ? hour + 24 : hour;
}

/** Which pending dose "খেয়েছি" means: by name, else by time of day, else the one due most recently. */
export function pickDose(doses: Dose[], subject: string | undefined, now = Date.now()): Dose | null {
  const open = doses.filter((d) => d.status === 'PENDING' || d.status === 'SNOOZED')
    .filter((d) => Date.parse(d.dueAt) <= now + 2 * 3_600_000);
  if (!open.length) return null;
  let pool = open;
  if (subject) {
    const byName = open.filter((d) => (d.medicineName ?? '').toLocaleLowerCase().includes(subject.toLocaleLowerCase()));
    const slot = TIME_OF_DAY.find(([re]) => re.test(subject));
    // A named medicine or a time of day that matches nothing is not a licence to mark
    // some other dose taken — it used to fall back to "any open dose".
    pool = byName.length ? byName : slot ? open.filter((d) => inSlot(d, slot)) : [];
  }
  return [...pool].sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt))[0] ?? null;
}

const inSlot = (d: Dose, slot: [RegExp, number, number]) => { const h = doseHour(d); return h >= slot[1] && h < slot[2]; };

/**
 * Why no dose could be marked — said plainly, never "maybe": already taken (and when),
 * not due yet (and when), or no dose at that time today at all.
 */
export function explainNoDose(doses: Dose[], subject: string | undefined, bn: boolean, now = Date.now()): string {
  const slot = subject ? TIME_OF_DAY.find(([re]) => re.test(subject)) : undefined;
  const named = subject && !slot ? doses.filter((d) => (d.medicineName ?? '').toLocaleLowerCase().includes(subject.toLocaleLowerCase())) : null;
  const pool = slot ? doses.filter((d) => inSlot(d, slot)) : named ?? doses;
  const time = (d: Dose) => formatBangladeshTime(d.dueAt, bn ? 'bn' : 'en');
  const label = (d: Dose) => `${d.medicineName ?? (bn ? 'ওষুধ' : 'medicine')} (${time(d)})`;
  if (!pool.length) {
    return subject
      ? (bn ? `আজ "${subject}"-এর কোনো ডোজ নেই।` : `There is no "${subject}" dose today.`)
      : (bn ? 'আজ কোনো ওষুধের ডোজ নেই।' : 'There are no doses today.');
  }
  const taken = pool.filter((d) => d.status === 'TAKEN');
  const later = pool.filter((d) => (d.status === 'PENDING' || d.status === 'SNOOZED') && Date.parse(d.dueAt) > now + 2 * 3_600_000);
  const lines: string[] = [];
  if (taken.length) lines.push(bn ? `✓ আগেই খাওয়া হয়েছে লেখা আছে: ${taken.map(label).join(', ')}` : `✓ Already marked taken: ${taken.map(label).join(', ')}`);
  if (later.length) lines.push(bn ? `⏰ এখনো সময় হয়নি: ${later.map(label).join(', ')}` : `⏰ Not due yet: ${later.map(label).join(', ')}`);
  const skipped = pool.filter((d) => d.status === 'SKIPPED');
  if (skipped.length) lines.push(bn ? `বাদ দেওয়া হয়েছে লেখা আছে: ${skipped.map(label).join(', ')}` : `Marked skipped: ${skipped.map(label).join(', ')}`);
  return lines.join('\n') || (bn ? 'এখন খাওয়ার মতো কোনো ডোজ বাকি নেই।' : 'No dose is due right now.');
}
