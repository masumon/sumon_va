import type { DateEntity, NlpEntities, NlpIntent, NlpPriority, TimeEntity, MoneyEntity, DebtEntity } from './types';
import { PRIORITY_KEYWORDS, TAG_HINTS } from './lexicon';
import { extractKeywords } from './keywords';
import { recoverCase } from './normalize';

// "show all my memories / notes" — a request to list everything, not to search a term.
// True when, after removing the list/show/all/my scaffolding and the word "memory/note"
// itself, nothing substantive is left.
const LIST_SCAFFOLD = /\b(?:all|every|my|show|list|see|view|open|the)\b|(?<![\p{L}\p{M}])(?:সব|সকল|সমস্ত|আমার|আমাদের|দেখাও|দেখাতে|দেখা|দেখি|তালিকা|খুলে|খোলো)(?![\p{L}\p{M}])|(?:মেমোরি|মেমরি|নোট|memor(?:y|ies)|notes?)(?:গুলো|স)?/giu;
function isListAllMemories(text: string): boolean {
  if (!/(?:মেমোরি|মেমরি|নোট|memor(?:y|ies)|\bnotes?\b)/iu.test(text)) return false;
  return !text.replace(LIST_SCAFFOLD, '').replace(/[\s।.,!?]+/gu, '').trim();
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  'রবিবার': 0, 'সোমবার': 1, 'মঙ্গলবার': 2, 'বুধবার': 3, 'বৃহস্পতিবার': 4, 'শুক্রবার': 5, 'শনিবার': 6,
};
// "kalke"/"aajke" are the romanized (Banglish) spellings of কালকে/আজকে — a Bengali
// speaker typing in Latin script without an IME, not a separate vocabulary (F-012).
const DATE_TERMS = ['day after tomorrow', 'yesterday', 'tomorrow', 'today', 'আগামীকাল', 'গতকাল', 'পরশু', 'কাল', 'আজ', 'kalke', 'aajke', 'ajke'] as const;
const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

// Bengali "word" boundary must exclude combining marks too, or "কাল" matches inside "বিকাল".
const NB = '[\\p{L}\\p{M}]';

function toAsciiDigits(value: string): string {
  return [...value].map((char) => { const index = BENGALI_DIGITS.indexOf(char); return index >= 0 ? String(index) : char; }).join('');
}
function startOfDay(date: Date): Date { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dateEntity(raw: string, date: Date): DateEntity { return { raw, isoDate: localIsoDate(date), confidence: 0.98 }; }
function findDateTerm(text: string): string | undefined {
  for (const term of DATE_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`(?<!${NB})${escaped}(?!${NB})`, 'u'));
    if (match) return match[0];
  }
  return undefined;
}

function shiftDays(base: Date, n: number): Date { const d = new Date(base); d.setDate(d.getDate() + n); return d; }

// Past and future said the way people say them (RC.1 QA): "গত পরশু", "৩ দিন পর", "২ দিন আগে",
// "আগামী সপ্তাহে", "আগামী মাসের ৫ তারিখে", "গত সোমবার", "in 3 days", "last monday", "tonight".
// Checked before the single-word terms, so "গত পরশু" is not read as plain "পরশু" (+2 days)
// and "গত সোমবার" is no longer taken for next Monday.
function relativeDate(t: string, base: Date): DateEntity | undefined {
  const dayBeforeYesterday = t.match(/গত\s*পরশু/u);
  if (dayBeforeYesterday) return dateEntity(dayBeforeYesterday[0], shiftDays(base, -2));
  const span = t.match(/(\d{1,3})\s*(দিন|সপ্তাহ|মাস|days?|weeks?|months?)\s*(পরে|পর|আগে|later|ago)(?![\p{L}\p{M}])/u)
    ?? t.match(/\bin\s+(\d{1,3})\s+(days?|weeks?|months?)\b/u);
  if (span) {
    const n = Number(span[1]); const sign = /আগে|ago/u.test(span[3] ?? '') ? -1 : 1; const d = new Date(base);
    if (/মাস|month/u.test(span[2]!)) d.setMonth(d.getMonth() + sign * n);
    else d.setDate(d.getDate() + sign * n * (/সপ্তাহ|week/u.test(span[2]!) ? 7 : 1));
    return dateEntity(span[0], d);
  }
  const nextMonthDay = t.match(/(?:আগামী|সামনের|পরের)\s*মাসের\s*(\d{1,2})\s*তারিখ/u);
  if (nextMonthDay) return dateEntity(nextMonthDay[0], new Date(base.getFullYear(), base.getMonth() + 1, Number(nextMonthDay[1])));
  const dayOfMonth = t.match(/(?:(?:এই|চলতি)\s*মাসের\s*)?(?<![\d/])(\d{1,2})\s*তারিখ/u);
  if (dayOfMonth && Number(dayOfMonth[1]) >= 1 && Number(dayOfMonth[1]) <= 31) return dateEntity(dayOfMonth[0], new Date(base.getFullYear(), base.getMonth(), Number(dayOfMonth[1])));
  const week = t.match(/(?:আগামী|সামনের|পরের|গত)\s*সপ্তাহ|\b(?:next|last)\s+week\b/u);
  if (week) return dateEntity(week[0], shiftDays(base, /গত|last/u.test(week[0]) ? -7 : 7));
  const month = t.match(/(?:আগামী|সামনের|পরের|গত)\s*মাস|\b(?:next|last)\s+month\b/u);
  if (month) { const d = new Date(base); d.setMonth(d.getMonth() + (/গত|last/u.test(month[0]) ? -1 : 1)); return dateEntity(month[0], d); }
  const lastWeekday = t.match(new RegExp(`(?:গত|last)\\s*(${Object.keys(WEEKDAYS).join('|')})`, 'u'));
  if (lastWeekday) { const target = WEEKDAYS[lastWeekday[1]!]!; return dateEntity(lastWeekday[0], shiftDays(base, -(((base.getDay() - target + 7) % 7) || 7))); }
  if (/\btonight\b/u.test(t)) return dateEntity('tonight', base);
  return undefined;
}

export function extractDate(text: string, now = new Date()): DateEntity | undefined {
  const normalized = toAsciiDigits(text.trim().toLocaleLowerCase());
  const base = startOfDay(now);
  const relative = relativeDate(normalized, base);
  if (relative) return relative;
  const dateTerm = findDateTerm(normalized);
  if (dateTerm === 'today' || dateTerm === 'আজ' || dateTerm === 'aajke' || dateTerm === 'ajke') return dateEntity(dateTerm, base);
  // "yesterday" / "গতকাল" was named in this function's own call site comment as already
  // handled ("গতকাল ৫০০ টাকা খরচ files itself on yesterday rather than today") but had no
  // branch here at all — `findDateTerm` could return it, and this function would then fall
  // through every `if` and return `undefined`, silently dating the expense today instead.
  if (dateTerm === 'yesterday' || dateTerm === 'গতকাল') { const date = new Date(base); date.setDate(date.getDate() - 1); return dateEntity(dateTerm, date); }
  if (dateTerm === 'tomorrow' || dateTerm === 'আগামীকাল' || dateTerm === 'কাল' || dateTerm === 'kalke') { const date = new Date(base); date.setDate(date.getDate() + 1); return dateEntity(dateTerm, date); }
  if (dateTerm === 'day after tomorrow' || dateTerm === 'পরশু') { const date = new Date(base); date.setDate(date.getDate() + 2); return dateEntity(dateTerm, date); }

  const numeric = normalized.match(/(?<!\d)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?(?!\d)/u);
  if (numeric) {
    const day = Number(numeric[1]); const month = Number(numeric[2]) - 1; const year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    const date = new Date(year, month, day);
    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) return dateEntity(numeric[0], date);
  }

  const weekday = Object.entries(WEEKDAYS).find(([name]) => normalized.includes(name));
  if (weekday) { const date = new Date(base); const delta = (weekday[1] - date.getDay() + 7) % 7 || 7; date.setDate(date.getDate() + delta); return dateEntity(weekday[0], date); }
  return undefined;
}

function normalizeHour(hour: number, meridiem?: string): number {
  if (!meridiem) return hour;
  // "মধ্যরাত ১২টা" is 00:00, "মাঝরাতে ১টায়" 01:00, "গভীর রাত ১১টায়" 23:00; "শেষ রাতে ৪টায়" 04:00.
  if (/^(?:মধ্যরাত|মাঝরাত|গভীর রাত)/u.test(meridiem)) return hour === 12 ? 0 : hour >= 9 ? hour + 12 : hour;
  if (/^(?:শেষ রাত|ভোর রাত)/u.test(meridiem)) return hour === 12 ? 0 : hour;
  const afternoon = /^(pm|p\.m\.|দুপুর|বিকাল|বিকেল|সন্ধ্যা)/u.test(meridiem);
  const morning = /^(am|a\.m\.|সকাল|ভোর)/u.test(meridiem);
  const night = /^(রাত)/u.test(meridiem);
  if (afternoon && hour < 12) return hour + 12;
  // "রাত ১০টা" is 22:00; "রাত ২টা" is 02:00 — past midnight, still said as night.
  if (night && hour >= 6 && hour < 12) return hour + 12;
  if ((morning || night) && hour === 12) return 0;
  return hour;
}

// The bare, unprefixed branch below ("১টা" with no সকাল/দুপুর/সময়/at leading it) only
// accepts "টায়" (the locative "at X o'clock"), never plain "টা" — "টা" alone is the
// everyday Bengali counting suffix for anything ("১টা ওষুধ", "১টা কলম"), and reading it
// as a time turned "সকালে নাপা ১টা খেতে হবে" (take one Napa tablet) into a task due at
// 01:00. A time-of-day mention that really means a clock time almost always carries an
// explicit marker somewhere — a period word, "সময়টা"/"at", or the colon form — all of
// which the other two branches already cover without this ambiguity.
// "১১:৩০-এ" / "৯টার দিকে": a case ending glued to the time used to hide it completely (RC.1 QA).
const TIME_PATTERN = /(?:(?:\bat\s+|সময়\s*|(?<period>মধ্যরাতে|মধ্যরাত|মাঝরাতে|মাঝরাত|শেষ রাতে|শেষ রাত|ভোর রাতে|গভীর রাতে|গভীর রাত|সকালে|সকাল|দুপুরে|দুপুর|বিকালে|বিকাল|বিকেলে|বিকেল|সন্ধ্যায়|সন্ধ্যা|রাতে|রাত|ভোরে|ভোর)\s*)(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<suffix>am|pm|a\.m\.|p\.m\.|টা|টায়)?|(?<plainHour>\d{1,2}):(?<plainMinute>\d{2})\s*(?<plainSuffix>am|pm|a\.m\.|p\.m\.)?|(?<suffixHour>\d{1,2})\s*(?<suffixOnly>am|pm|a\.m\.|p\.m\.|টায়))(?=\s|$|[.,!?।]|-?(?:এ|তে|টায়|টায়|টার)(?![\p{L}\p{M}]))/u;

// "in 2 hours" / "২ ঘণ্টা পর" / "30 min later" / "আধা ঘণ্টা পর" → an absolute time today.
const REL_TIME_PATTERN = /(?:in\s+)?(\d{1,3})\s*(hour|hr|hours|hrs|minute|min|mins|minutes|ঘণ্টা|ঘন্টা|মিনিট)\s*(?:later|from now|পর|পরে)?/u;

export function extractRelativeTime(text: string, now = new Date()): { date: DateEntity; time: TimeEntity } | undefined {
  const normalized = toAsciiDigits(text.trim().toLocaleLowerCase());
  if (!/\b(?:later|from now|in\s+\d)|পর|পরে/u.test(normalized)) return undefined;
  const m = normalized.match(REL_TIME_PATTERN);
  if (!m) return undefined;
  const qty = Number(m[1]);
  const unit = m[2]!;
  const deltaMin = /hour|hr|ঘণ্টা|ঘন্টা/u.test(unit) ? qty * 60 : qty;
  if (!Number.isFinite(deltaMin) || deltaMin <= 0 || deltaMin > 60 * 24 * 7) return undefined;
  const target = new Date(now.getTime() + deltaMin * 60_000);
  return {
    date: { raw: m[0], isoDate: localIsoDate(target), confidence: 0.9 },
    time: { raw: m[0], minutes: target.getHours() * 60 + target.getMinutes(), confidence: 0.9 },
  };
}

export function extractPriority(text: string): NlpPriority | undefined {
  const t = text.toLocaleLowerCase();
  if (PRIORITY_KEYWORDS.URGENT.some((k) => t.includes(k))) return 'URGENT';
  if (PRIORITY_KEYWORDS.HIGH.some((k) => t.includes(k))) return 'HIGH';
  if (PRIORITY_KEYWORDS.LOW.some((k) => t.includes(k))) return 'LOW';
  return undefined;
}

export function extractTags(text: string): string[] {
  const t = text.toLocaleLowerCase();
  const tags: string[] = [];
  for (const [tag, words] of Object.entries(TAG_HINTS)) {
    // Whole-word match only — an unanchored `includes` fired "family" for "আমার"
    // (contains "মা") and "son"/"reason"/"person".
    const hit = words.some((w) => {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const re = /[a-z]/u.test(w[0] ?? '')
        ? new RegExp(`\\b${esc}\\b`, 'u')
        // Bengali takes its case endings on the word itself: "বাবার ওষুধ" is family too
        // (rc.6 QA T65). The start stays anchored, so "আমার" still never reads as "মা".
        : new RegExp(`(?<![\\p{L}\\p{M}])${esc}(?:র|এর|ের|কে|দের|রা)?(?![\\p{L}\\p{M}])`, 'u');
      return re.test(t);
    });
    if (hit) tags.push(tag);
  }
  return tags.slice(0, 3);
}

// "সন্ধ্যায় বাজার করতে হবে" names a part of the day but no clock time: the usual hour for it,
// marked approximate (0.7) — the confirm card shows it before anything is saved. The
// genitive ("সকালের ওষুধ") is not a time and does not match.
const PERIOD_DEFAULTS: [RegExp, number][] = [
  [/(?<![\p{L}\p{M}])(?:মধ্যরাত|মাঝরাত|গভীর রাত)(?:ে)?(?![\p{L}\p{M}])|\bmidnight\b/u, 0],
  [/(?<![\p{L}\p{M}])(?:শেষ রাত|ভোর রাত)(?:ে)?(?![\p{L}\p{M}])/u, 4 * 60],
  [/(?<![\p{L}\p{M}])ভোর(?:ে)?(?![\p{L}\p{M}])|\bdawn\b/u, 6 * 60],
  [/(?<![\p{L}\p{M}])সকাল(?:ে)?(?![\p{L}\p{M}])|\bmorning\b/u, 9 * 60],
  [/\bnoon\b/u, 12 * 60],
  [/(?<![\p{L}\p{M}])দুপুর(?:ে)?(?![\p{L}\p{M}])/u, 13 * 60],
  [/(?<![\p{L}\p{M}])(?:বিকাল|বিকেল)(?:ে)?(?![\p{L}\p{M}])|\bafternoon\b/u, 16 * 60],
  [/(?<![\p{L}\p{M}])সন্ধ্যা(?:য়|য়)?(?![\p{L}\p{M}])|\bevening\b/u, 19 * 60],
  [/(?<![\p{L}\p{M}])রাত(?:ে)?(?![\p{L}\p{M}])|\b(?:tonight|night)\b/u, 21 * 60],
];
function periodOnly(t: string): TimeEntity | undefined {
  for (const [re, minutes] of PERIOD_DEFAULTS) {
    const m = t.match(re);
    if (m) return { raw: m[0], minutes, confidence: 0.7 };
  }
  return undefined;
}

export function extractTime(text: string): TimeEntity | undefined {
  const normalized = toAsciiDigits(text.trim().toLocaleLowerCase()).replace(/\u09DF/gu, 'য়');
  const match = normalized.match(TIME_PATTERN);
  if (!match?.groups) return periodOnly(normalized);
  const groups = match.groups;
  const hour = Number(groups.hour ?? groups.plainHour ?? groups.suffixHour);
  const minute = Number(groups.minute ?? groups.plainMinute ?? 0);
  const meridiem = groups.period ?? groups.suffix ?? groups.plainSuffix ?? groups.suffixOnly;
  if (hour > 23 || minute > 59) return undefined;
  const normalizedHour = normalizeHour(hour, meridiem);
  if (normalizedHour > 23) return undefined;
  return { raw: match[0].trim(), minutes: normalizedHour * 60 + minute, confidence: 0.96 };
}

// The date phrases relativeDate reads, taken out of a task title or an expense category —
// "3 দিন পর ডাক্তারের কাছে যেতে হবে" is the task "ডাক্তারের কাছে যেতে হবে". Not applied to
// memories, where "দোকান শুক্রবার বন্ধ থাকে" must keep its weekday.
const DATE_PHRASES = new RegExp([
  'গত\\s*পরশু',
  '\\d{1,3}\\s*(?:দিন|সপ্তাহ|মাস)\\s*(?:পরে|পর|আগে)(?![\\p{L}\\p{M}])',
  '(?:(?:আগামী|সামনের|পরের|এই|চলতি)\\s*)?মাসের\\s*\\d{1,2}\\s*তারিখে?',
  '(?<![\\d/])\\d{1,2}\\s*তারিখে?',
  '(?:আগামী|সামনের|পরের|গত)\\s*(?:সপ্তাহে|সপ্তাহ|মাসে|মাস)(?![\\p{L}\\p{M}])',
  `(?:গত|আগামী|সামনের|পরের|এই)\\s*(?:${Object.keys(WEEKDAYS).join('|')})(?:ে)?`,
  '\\bin\\s+\\d{1,3}\\s+(?:days?|weeks?|months?)\\b',
  '\\b\\d{1,3}\\s+(?:days?|weeks?|months?)\\s+ago\\b',
  '\\b(?:next|last)\\s+(?:week|month)\\b',
  '\\blast\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\b',
].join('|'), 'giu');
export function stripDatePhrases(text: string): string {
  return text.replace(DATE_PHRASES, ' ').replace(/\s+/gu, ' ').trim();
}

function removeDateTime(text: string): string {
  // Longest first, and the spoken "-কে/-কের" forms too: "আজকে" used to survive this and
  // end up as an expense category ("আজক").
  let cleaned = text.replace(new RegExp(`(?<!${NB})(?:day after tomorrow|today|tomorrow|yesterday|আজকের|আজকে|আজ|আগামীকালকে|আগামীকাল|গতকালকে|গতকাল|কালকের|কালকে|কাল|পরশু)(?!${NB})`, 'gu'), ' ');
  cleaned = cleaned.replace(/(?<!\d)\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{4})?(?!\d)/gu, ' ');
  // English weekday references ("next Monday", "on friday") — the date is captured
  // by extractDate; drop the words so the stored title stays clean.
  cleaned = cleaned.replace(/(?<![\p{L}\p{M}])(?:(?:next|this|coming|on)\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?![\p{L}\p{M}])/giu, ' ');
  // Strip the time span while the period word ("বিকাল" etc.) is still present so
  // extractTime can resolve AM/PM, then mop up any leftover bare period / "Nটা".
  const time = extractTime(cleaned);
  if (time) {
    const at = cleaned.indexOf(time.raw);
    // The case ending glued to the time goes with it: "11:30-এ বাবাকে ফোন" → "বাবাকে ফোন".
    if (at >= 0) cleaned = cleaned.slice(0, at) + ' ' + cleaned.slice(at + time.raw.length).replace(/^-?(?:এ|তে|টায়|টায়|টার)(?![\p{L}\p{M}])/u, '');
  }
  cleaned = cleaned.replace(/(?<![\p{L}\p{M}])(?:মধ্যরাতে|মধ্যরাত|মাঝরাতে|মাঝরাত|শেষ রাতে|শেষ রাত|ভোর রাতে|গভীর রাতে|গভীর রাত|সকালে|সকাল|দুপুরে|দুপুর|বিকালে|বিকাল|বিকেলে|বিকেল|সন্ধ্যায়|সন্ধ্যা|রাতে|রাত|ভোরে|ভোর|(?:early\s+|this\s+|in\s+the\s+)?(?:morning|afternoon|evening|tonight|midnight|noon))(?![\p{L}\p{M}])/giu, ' ');
  cleaned = cleaned.replace(/(?<![\p{L}\p{M}])\d{1,2}\s*(?:টা|টায়)(?![\p{L}\p{M}])/gu, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
}
// Leading conversational scaffolding for English task capture — stripped so the stored
// task title reads "pay the rent", not "remind me to pay the rent".
const EN_TASK_PREFIX =
  /^(?:(?:i\s+(?:need|have|want|got)\s+to|i\s+must|i'?d\s+like\s+to|don'?t\s+forget\s+to|make\s+sure\s+to|remember\s+to|remind\s+me\s+to|need\s+to|have\s+to|got\s+to|gotta|please|kindly|can\s+you|could\s+you|task\s*[:-]?)\s+)+/u;

function cleanContent(text: string): string {
  return text
    .replace(/^(please|pls|দয়া করে|দয়া করে|আমাকে|একটা|একটি)\s+/u, '')
    .replace(EN_TASK_PREFIX, '')
    .replace(/^(remember|save|note|search|find|add a task to|create a task to|make a task to|add task|new task|todo|to-do|মনে রাখো|মনে রাখ|মনে রাখবে|নোট করো|কাজ যোগ করো|কাজ যোগ|খুঁজে দাও|খুঁজে দেখ|খুঁজে|পিছিয়ে দাও|পিছিয়ে দাও|করতে হবে)\s*[:,-]?\s*/u, '')
    .replace(EN_TASK_PREFIX, '')
    .replace(/(?<![\p{L}\p{M}])(?:কাজটা|কাজটি|কাজটার|কাজটিকে)(?![\p{L}\p{M}])/u, ' ')
    .replace(/\s+(please|pls|দয়া করে|দয়া করে|খুঁজে দাও|খুঁজে দেখ|খুঁজে দিন|পিছিয়ে দাও|পিছিয়ে দাও|করে দাও|করে দিন|কমপ্লিট|কম্পলিট|সম্পন্ন|হয়ে গেছে|শেষ হয়েছে|শেষ|করে ফেলেছি|করেছি|সেরে ফেলেছি)$/u, '')
    // The reminder wording itself is not the task: "ওষুধ কিনতে মনে করিয়ে দিও" → "ওষুধ কিনতে".
    .replace(/\s*(?:(?:এর|র)\s+)?(?:reminder|রিমাইন্ডার|অ্যালার্ম|এলার্ম|alarm)\s*(?:দাও|দিও|দিন|দিবে|দেবে|সেট\s*কর\S*|রাখ\S*)?$/iu, '')
    .replace(/\s+মনে\s*করিয়ে\s*(?:দিও|দিয়ো|দাও|দিবে|দেবে|দিন)$/u, '')
    // "ওষুধ খাওয়ার কথা মনে করিয়ে দিবা" (spoken forms too) → "ওষুধ খাওয়ার".
    .replace(/\s+(?:কথা\s+)?মনে\s*করি(?:য়|য়)ে\s*(?:দিও|দি(?:য়|য়)ো|দাও|দিবে|দেবে|দিন|দিবা|দিবেন|দি(?:য়|য়)েন|দিস)$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const BN_DIGIT_MAP = '০১২৩৪৫৬৭৮৯';

/** Words that mean money came in rather than went out. */
const INCOME_WORDS = /আয়|পেয়েছি|পেলাম|বেতন|income|earned|received|salary/u;

/**
 * The sum, the direction and the category, out of a sentence that says money moved.
 *
 * Deliberately narrow. It requires digits — a sentence with no number is not a record of
 * a payment — and it takes the category only from a word that is actually there. An
 * assistant guessing "বাজার" because most expenses are groceries would be writing
 * something into a ledger that nobody said.
 */
export function extractMoney(text: string): MoneyEntity | undefined {
  const ascii = text.replace(/[০-৯]/gu, (d) => String(BN_DIGIT_MAP.indexOf(d)));
  // Not a year, and not a time of day already claimed by the clock parser. A number beside
  // "টাকা/৳" wins; otherwise the first one that is not counting something else — "তিন মাস"
  // (normalised to "3 মাস") is a period, and it once became a 3-taka expense.
  const NUMBER = /(?<!:)\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)\b(?!\s*:)/gu;
  const candidates = [...ascii.matchAll(NUMBER)];
  const followedBy = (m: RegExpMatchArray) => ascii.slice((m.index ?? 0) + m[0].length);
  const match = candidates.find((m) => /^\s*(?:টাকা|৳|tk\b|taka\b)/u.test(followedBy(m)))
    ?? candidates.find((m) => !/^\s*(?:মাস|দিন|সপ্তাহ|বছর|ঘণ্টা|ঘন্টা|মিনিট|জন|টা(?![\p{L}\p{M}])|টায়|বার|কেজি|লিটার|months?|days?|weeks?|years?|hours?|minutes?|times?|kg)/u.test(followedBy(m)));
  if (!match) return undefined;
  const taka = Number(match[1]!.replace(/,/gu, ''));
  if (!Number.isFinite(taka) || taka <= 0) return undefined;

  const kind = INCOME_WORDS.test(text) ? 'INCOME' as const : 'EXPENSE' as const;

  // The category is the noun the sentence put next to the money — "বাজারে", "ওষুধ",
  // "on groceries". Taken from the words around the sum, with the date, the money words,
  // the verbs and the speaker themself removed; whatever survives is what the person
  // called it. Without stripping the subject, an entirely ordinary way of saying this —
  // "আমি বাজারে ৫০০ টাকা খরচ করেছি" / "I spent 500 taka on medicine" — filed itself as
  // "আমি বাজার" / "I medicine", a category that will never match the one the next entry
  // gets, so spending-by-category silently fragments into one garbage row per phrasing.
  const withoutSum = removeDateTime(text).replace(/[০-৯\d][০-৯\d,.]*/gu, ' ');
  const category = withoutSum
    .replace(/টাকা|৳|\btk\b|\btaka\b/giu, ' ')
    .replace(/খরচ\S*|ব্যয়\S*|দিলাম|দিয়েছি|লাগল|লেগেছে|হয়েছে|করেছি|হল(?:ো|াম|ে)?(?![\p{L}\p{M}])|আয়\S*|পেয়েছি|পেলাম/gu, ' ')
    .replace(/আমাদের|আমরা|আমার|আমি|তোমাদের|তোমরা|তোমার|তুমি|আপনাদের|আপনার|আপনি/gu, ' ')
    .replace(/\bspent\b|\bpaid\b|\bincome\b|\bearned\b|\breceived\b|\bon\b|\bfor\b|\bwas\b/giu, ' ')
    .replace(/\bi\b|\bmy\b|\bme\b|\bwe\b|\bour\b|\byou\b|\byour\b/giu, ' ')
    .replace(/লিখো|লিখে রাখ\S*|লিখে দাও|রেখে দাও|যোগ কর\S*|record|add|note/giu, ' ')
    // Spoken verbs of money leaving, and the connective words around a category.
    .replace(/(?<![\p{L}\p{M}])(?:চলে গেছে|গেছে|গেল|হিসাবে|হিসেবে|জন্য|বাবদ)(?![\p{L}\p{M}])/gu, ' ')
    .replace(/[,،।.!?;:]/gu, ' ')
    // A vowel sign with no letter before it is what is left of a cut word ("হলো" → "ো"),
    // never a category (rc.13 review).
    .replace(/(?<![\p{L}\p{M}])\p{M}+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  // "ওটার জন্য" names no category — it points at one. Flagged for the orchestrator to
  // resolve from context (or ask), never stored as the literal word.
  // The same goes for the ways of saying "the same one again": "আগেরবারের মতো", "একইটায় আরও",
  // "এটাও", "একই খাতে". The filler around the pointer is dropped before the check, and the
  // pointer may carry any case ending or the "ও"/"ই" of "too"/"itself".
  const pointer = category
    .replace(/(?<![\p{L}\p{M}])(?:আরও|আরো|আবারও|আবার|মতো|মত|মতন|খাতে\S*|জায়গায়|same|again|as|last|time|too)(?![\p{L}\p{M}])/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (/^(?:ওটা|এটা|সেটা|আগেরটা|একইটা|ওইটা|ঐটা|আগেরবার|গতবার|একই|ওই|ঐ)(?:র|ার|ের|য়|তে|ও|ই)*$/u.test(pointer) || (category && !pointer)) {
    return { kind, amountPaisa: Math.round(taka * 100), categoryRef: true };
  }
  // "বাজারে"/"বাজারের" -> "বাজার": the case ending is how it is said, not how it is filed.
  const filed = category.replace(/(?:ের|এর|তে|য়ে|ে)$/u, '').replace(/(?<=[\p{L}\p{M}]{2}া)(?:য়|য়)$/u, '');

  return { kind, amountPaisa: Math.round(taka * 100), category: filed || undefined };
}

// Bengali dative pronouns end in "কে" exactly the way a person's name would ("রহিমকে"),
// so the suffix alone cannot tell "gave Rahim" from "gave him" — these have to be ruled
// out by name, not by shape.
const BN_DATIVE_PRONOUNS = new Set(['আমাকে', 'আমাদেরকে', 'তোমাকে', 'তোমাদেরকে', 'আপনাকে', 'আপনাদেরকে', 'ওকে', 'তাকে', 'তাদেরকে', 'কাকে', 'নিজেকে', 'সবাইকে']);

/**
 * A word bearing to/from a specific person — borrowing or lending, not a purchase.
 *
 * `direction: 'DEBT'` is money the speaker took (they now owe it back); `RECEIVABLE` is
 * money the speaker handed over (someone now owes it back to them). The plain "-কে ...
 * দিলাম" shape (no ধার/ঋণ word at all) is deliberately included: "রহিমকে ২০০০ টাকা
 * দিলাম" is a hand loan exactly as much as "রহিমকে ২০০০ টাকা ধার দিলাম" is — Bengali
 * often leaves the word out — and filing it as a plain EXPENSE (what RECORD_EXPENSE's own
 * "দিলাম" pattern would otherwise claim first) lost the fact that it is owed back at all.
 */
export function extractDebt(text: string): DebtEntity | undefined {
  const ascii = text.replace(/[০-৯]/gu, (d) => String(BN_DIGIT_MAP.indexOf(d)));
  const sumMatch = ascii.match(/\b(\d{1,3}(?:,\d{3})+|\d+)\b/u);
  if (!sumMatch) return undefined;
  const taka = Number(sumMatch[1]!.replace(/,/gu, ''));
  if (!Number.isFinite(taka) || taka <= 0) return undefined;
  const amountPaisa = Math.round(taka * 100);

  const borrowed = /(?<![\p{L}\p{M}])(?:ধার|লোন|ঋণ)\s*(?:নিলাম|নিয়েছি|করলাম|নিলেন|নিয়েছেন|নিছি)(?![\p{L}\p{M}])|\b(?:borrowed|took a loan|took out a loan)\b/iu.test(text);
  const lentWithWord = /(?<![\p{L}\p{M}])(?:ধার|লোন|ঋণ)\s*(?:দিলাম|দিয়েছি|দিলেন|দিয়েছেন)(?![\p{L}\p{M}])|\b(?:lent|loaned)\b/iu.test(text);
  // The bare dative shape, with no ধার/ঋণ word: "<name>কে <sum> টাকা দিলাম/দিয়েছি".
  const bareDativeGive = /(?<![\p{L}\p{M}])([^\s,।]+)কে\s+.{0,20}?(?:টাকা|৳)\s*.{0,10}?(?:দিলাম|দিয়েছি|দিলেন|দিয়েছেন)(?![\p{L}\p{M}])/u.exec(text);

  let direction: 'DEBT' | 'RECEIVABLE' | undefined;
  if (borrowed) direction = 'DEBT';
  else if (lentWithWord || bareDativeGive) direction = 'RECEIVABLE';
  if (!direction) return undefined;

  let personName: string | undefined;
  if (bareDativeGive) {
    const token = bareDativeGive[1]! + 'কে';
    if (!BN_DATIVE_PRONOUNS.has(token)) personName = bareDativeGive[1];
  }
  if (!personName) {
    // Borrowing names the lender after "থেকে" ("রহিমের কাছ থেকে ধার নিলাম"); lending
    // with the ধার/ঋণ word explicit still often names the person with "-কে".
    const fromMatch = /([^\s,।]+?)(?:ের কাছ থেকে|র কাছ থেকে|-?এর কাছ থেকে)/u.exec(text)
      ?? /\bfrom\s+([A-Za-z][\w'-]*)/iu.exec(text)
      // "করিম ভাই থেকে", "রহিমের থেকে" — without "কাছ"; the honorific stays with the name.
      ?? /(?<![\p{L}\p{M}])((?!আমা|তোমা|আপনা|তা(?![\p{L}\p{M}])|ওখান|এখান|সেখান)[\p{L}\p{M}]{2,}?(?:\s+(?:ভাই|ভাইয়া|ভাইয়া|আপা|আপু|ভাবী|ভাবি|চাচা|মামা|খালা|কাকা|সাহেব|দা))?)(?:ের|এর|র)?\s+থেকে(?![\p{L}\p{M}])/u.exec(text);
    const toMatch = /([^\s,।]+)কে(?![\p{L}\p{M}])/u.exec(text)
      ?? /\b(?:to|lent|loaned)\s+([A-Za-z][\w'-]*)/iu.exec(text);
    const pick = direction === 'DEBT' ? fromMatch : toMatch;
    if (pick) {
      const candidate = pick[1]!;
      if (!BN_DATIVE_PRONOUNS.has(candidate + 'কে') && !/^(?:to|lent|loaned|a|loan)$/iu.test(candidate)) {
        personName = candidate;
      }
    }
  }

  return { direction, amountPaisa, personName };
}

// "প্রতিদিন সকাল ৮টায় প্রেসারের ওষুধ" is a daily task, not tomorrow's (rc.6 QA T16).
const RECURRENCE: [RegExp, NonNullable<NlpEntities['recurrence']>][] = [
  [/(?<![\p{L}\p{M}])(?:প্রতি\s*কর্মদিবসে|কর্মদিবসে|weekdays|every\s+weekday)(?![\p{L}\p{M}])/iu, 'WEEKDAYS'],
  [/(?<![\p{L}\p{M}])(?:প্রতিদিন|প্রতি\s*দিন|রোজ|দৈনিক|daily|every\s*day|each\s+day)(?![\p{L}\p{M}])/iu, 'DAILY'],
  [/(?<![\p{L}\p{M}])(?:প্রতি\s*সপ্তাহে?|সাপ্তাহিক|weekly|every\s+week)(?![\p{L}\p{M}])/iu, 'WEEKLY'],
  [/(?<![\p{L}\p{M}])(?:প্রতি\s*মাসে?|মাসিক|monthly|every\s+month)(?![\p{L}\p{M}])/iu, 'MONTHLY'],
];
export function extractRecurrence(text: string): NlpEntities['recurrence'] {
  return RECURRENCE.find(([re]) => re.test(text))?.[1];
}
const RECURRENCE_WORDS = /(?<![\p{L}\p{M}])(?:প্রতি\s*কর্মদিবসে|কর্মদিবসে|প্রতিদিন|প্রতি\s*দিন|রোজ|দৈনিক|প্রতি\s*সপ্তাহে?|সাপ্তাহিক|প্রতি\s*মাসে?|মাসিক|daily|every\s*day|each\s+day|every\s+weekday|weekdays|weekly|every\s+week|monthly|every\s+month)(?![\p{L}\p{M}])/giu;

export function extractEntities(text: string, intent: NlpIntent, now = new Date(), rawCased?: string): NlpEntities {
  const relative = extractRelativeTime(text, now);
  const date = relative?.date ?? extractDate(text, now);
  const time = relative?.time ?? extractTime(text);
  const cleaned = removeDateTime(text);
  const content = cleanContent(cleaned);
  // Give stored content back the user's original capitalisation (passwords, proper nouns).
  const cased = (value: string) => (rawCased ? recoverCase(rawCased, value) : value);
  if (intent === 'CREATE_TASK' || intent === 'RESCHEDULE_TASK') {
    const taskText = stripDatePhrases(content)
      .replace(RECURRENCE_WORDS, ' ')
      .replace(/^\s+/u, '')
      .replace(/^(?:রবিবার|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার|শুক্রবার|শনিবার|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+/iu, '')
      .replace(REL_TIME_PATTERN, '')
      .replace(/\s+(?:(?:top|high|low|medium|normal)\s+)?(?:priority|importance)\s*$/iu, '')
      .replace(/\s+(?:urgent|asap|important|!!+|জরুরি|গুরুত্বপূর্ণ|এখনই|তাড়াতাড়ি|অগ্রাধিকার)\s*$/iu, '')
      .replace(/\s+(?:morning|afternoon|evening|night)\s*$/iu, '')
      // "মিটিংটা … সরিয়ে দাও" → the task is "মিটিং"; the move is what RESCHEDULE does.
      .replace(/\s+(?:সরি|পিছি|এগি)(?:য়|য়)ে\s*(?:দাও|দিন|দিও|নাও|আনো)?\s*$/u, '')
      .replace(/^([\p{L}\p{M}]{3,}?)(?:টা|টি)$/u, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    const recurrence = intent === 'CREATE_TASK' ? extractRecurrence(text) : undefined;
    return { taskText: taskText ? cased(taskText) : undefined, date, time, priority: extractPriority(text), tags: extractTags(text), ...(recurrence ? { recurrence } : {}) };
  }
  // "দুধ কেনার কাজটা শেষ হয়েছে" names the task it closes — read it, instead of leaving the
  // orchestrator to fall back on whatever task the conversation last mentioned. A bare
  // pointer ("সেটা শেষ হয়েছে") names nothing and is left to the context, as before.
  if (intent === 'COMPLETE_TASK') {
    const named = content
      .replace(/(?<![\p{L}\p{M}])(?:শেষ\s*(?:হয়েছে|হয়ে\s*গেছে|কর\S*|হলো|হল)?|হয়ে\s*গেছে|করা\s*(?:হয়েছে|শেষ)|সম্পন্ন\s*\S*|কমপ্লিট\s*\S*|করে\s*(?:দাও|দিন|ফেলেছি)|ডান|done|finished|complete[ds]?|mark(?:ed)?(?:\s+as)?|is|was)(?![\p{L}\p{M}])/giu, ' ')
      .replace(/(?<![\p{L}\p{M}])(?:কাজটা|কাজটি|কাজ|টাস্কটা|টাস্ক|task|the)(?![\p{L}\p{M}])/giu, ' ')
      .replace(/[,।.!?]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      // "দুধ কেনার" → "দুধ কেনা": the genitive belongs to "কাজটা", not to the task.
      .replace(/(?<=[\p{L}\p{M}]{2})(?:ের|এর)$/u, '')
      .replace(/(?<=[\p{L}\p{M}]{2})ার$/u, 'া')
      .replace(/(?<=[\p{L}\p{M}][া-ৌ])র$/u, '');
    const pointer = /^(?:সেটা|ওটা|এটা|আগেরটা|ওইটা|that|it|this)$/iu.test(named);
    return named && !pointer ? { taskText: cased(named) } : {};
  }
  // Money already spent or received. The date comes from the same clock parser everything
  // else uses, so "গতকাল ৫০০ টাকা খরচ" files itself on yesterday rather than today.
  if (intent === 'RECORD_EXPENSE') return { money: extractMoney(stripDatePhrases(text)), date, time };
  if (intent === 'ANALYZE_SPENDING') {
    // "গত ৩ মাস" (number words are already digits here) → 3; "গত মাস"/"এ মাস" → 1; else 3.
    const ascii = text.replace(/[০-৯]/gu, (d) => String(BN_DIGIT_MAP.indexOf(d)));
    const counted = ascii.match(/(\d{1,2})\s*(?:মাস|months?)/u);
    const one = /(?:গত|এই|এ|চলতি|last|this)\s*(?:মাস|month)(?!\s*গুলো)/u.test(ascii);
    return { periodMonths: counted ? Number(counted[1]) : one ? 1 : 3 };
  }
  if (intent === 'CREATE_DEBT') return { debt: extractDebt(text), date, time };
  if (intent === 'CREATE_MEMORY') {
    // "আমার প্রিয় রং নীল এটা মনে রাখো" / "… remember this" — the instruction and its
    // pointer are how it was asked, not part of what is kept.
    const kept = content
      .replace(/[\s,।.!]*(?:(?:এটা|এটাও|ওটা|সেটা|কথাটা|এই\s*কথাটা)\s+)?(?:মনে\s*রাখ\S*|লিখে\s*রাখ\S*|সেভ\s*কর\S*|নোট\s*কর\S*)[\s।.!]*$/u, '')
      .replace(/[\s,.!]*(?:please\s+)?(?:remember|save|note)(?:\s+(?:this|that|it))?[\s.!]*$/iu, '')
      .trim() || content;
    return { memoryText: kept ? cased(kept) : undefined, keywords: extractKeywords(kept || text), tags: extractTags(text), date };
  }
  if (intent === 'SEARCH_MEMORY') {
    if (isListAllMemories(text)) return { query: '', keywords: [] }; // '' = list everything
    return { query: content || undefined, keywords: extractKeywords(content || text) };
  }
  if (intent === 'ANSWER_QUESTION' || intent === 'UNKNOWN') {
    // UNKNOWN still gets a question + keywords so the orchestrator can fall back to a
    // best-effort lookup ("আমার wifi পাসওয়ার্ড দাও") instead of a dead end.
    const question = text.trim();
    return { question: question || undefined, keywords: extractKeywords(text), date, time };
  }
  if (intent === 'HELP' || intent === 'SMALL_TALK') {
    return { question: text.trim() || undefined };
  }
  return { date, time };
}
