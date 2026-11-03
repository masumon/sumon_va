// "Last year, around this date, I spent five hundred taka — on what?"
//
// That is a real question people ask their own records, and until now nothing in the app
// could answer it. Search matched text, so it found an amount only when the amount had
// been typed into a note; each module searched its own table, so a five hundred that went
// on medicine and a five hundred that repaid a friend were two searches; and no screen
// understood "last year" at all.
//
// What makes it answerable now is `life_events`: every module writes one row there for
// anything that happens, with the amount, the business date, the kind, and who it was
// with. One question, one query, every domain.
//
// The parsing is deliberately rule-based and offline — the same decision the rest of the
// app's language handling makes. A question it cannot read returns nothing rather than a
// guess, because a wrong answer about money is worse than no answer.

import type { SQLiteDatabase } from 'expo-sqlite';
import { bangladeshDateKey, type AppLanguage } from '../i18n/date-time';
import type { LifeEvent } from './life-event-service';
import { eventTypeLabel, eventWord } from './life-event-copy';
import { formatPaisa } from './debt/money';

/** What a question turned out to be asking. Every part is optional; a question may set none. */
export interface MoneyQuestion {
  /** In paisa, when the question named a sum. */
  amountPaisa?: number;
  /** How far either side of that sum still counts as the same payment. */
  tolerancePaisa?: number;
  from?: string;
  to?: string;
  /** REPAY, MEDICAL, INCOME… when the question named a kind. */
  types?: string[];
  /** Words left over after the amount and the dates were taken out. */
  text?: string;
  /**
   * The question wants one figure, not a list — "how much did I spend on medicine".
   *
   * A different question from "which five hundred was that", and it has to be told apart
   * before the query runs: one is answered by a sum over everything that matches, the
   * other by the rows themselves.
   */
  aggregate?: boolean;
  /** A person the question named, matched against the name on the event. */
  person?: string;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const toAsciiDigits = (s: string) => s.replace(/[০-৯]/gu, (d) => String(BN_DIGITS.indexOf(d)));

/** The month names a person might type, in either language, in the order Date uses. */
const MONTHS: [RegExp, number][] = [
  [/জানু|january|jan\b/iu, 0], [/ফেব্রু|february|feb\b/iu, 1], [/মার্চ|march|mar\b/iu, 2],
  [/এপ্রিল|april|apr\b/iu, 3], [/মে\b|may\b/iu, 4], [/জুন|june|jun\b/iu, 5],
  [/জুলাই|july|jul\b/iu, 6], [/আগস্ট|august|aug\b/iu, 7], [/সেপ্টেম্বর|september|sep\b/iu, 8],
  [/অক্টোবর|october|oct\b/iu, 9], [/নভেম্বর|november|nov\b/iu, 10], [/ডিসেম্বর|december|dec\b/iu, 11],
];

/** Everything that takes money out of a pocket, whatever the app calls it elsewhere. */
const OUTGOING = ['EXPENSE', 'MEDICAL', 'REPAY', 'LEND', 'ASSET_BUY', 'GIFT_OUT', 'LOSS'];
/** And everything that puts it in. */
const INCOMING = ['INCOME', 'COLLECT', 'BORROW', 'ASSET_SELL', 'GIFT_IN', 'FOUND'];

/**
 * Which kinds of event a word points at. Ordered: the most specific phrase wins.
 *
 * "খরচ" is deliberately every outgoing kind rather than only `EXPENSE`. The app is careful
 * elsewhere that repaying a loan is not household spending — that distinction is what keeps
 * the monthly totals honest — but someone asking where five hundred taka went is asking
 * about the taka, not about a category, and answering "nothing found" because it happened
 * to leave as a repayment would be technically right and useless.
 */
const TYPE_WORDS: [RegExp, string[]][] = [
  [/ঋণ পরিশোধ|ধার শোধ|শোধ করেছি|repaid|repay/iu, ['REPAY']],
  [/পাওনা আদায়|আদায়|collected|collect/iu, ['COLLECT']],
  [/ধার নিয়ে|ধার নিলাম|ধার করেছি|borrow/iu, ['BORROW']],
  [/ধার দিয়ে|ধার দিলাম|lent|lend/iu, ['LEND']],
  [/ঋণ|দেনা|পাওনা|debt|loan/iu, ['REPAY', 'COLLECT', 'BORROW', 'LEND']],
  [/চিকিৎসা|ডাক্তার|ওষুধ|হাসপাতাল|medical|doctor|medicine|health/iu, ['MEDICAL']],
  [/আয়|রোজগার|বেতন|income|earned|salary/iu, INCOMING],
  [/খরচ|ব্যয়|খরচা|গেল|spent|expense|went/iu, OUTGOING],
];

/**
 * Read a question for the things that can be turned into a query.
 *
 * `now` is injectable because every relative period is relative to something, and a test
 * that depends on the real clock passes in March and fails in April.
 */
export function parseMoneyQuestion(text: string, now = new Date()): MoneyQuestion {
  const raw = text.trim();
  if (!raw) return {};
  const ascii = toAsciiDigits(raw);
  const q: MoneyQuestion = {};

  // ── the sum ────────────────────────────────────────────────────────────────
  // Any run of digits that is not obviously a year. Four digits starting 19 or 20 in a
  // question about last year is a year, not five thousand taka.
  const numbers = [...ascii.matchAll(/\d+(?:[.,]\d+)?/gu)].map((m) => m[0].replace(/,/gu, ''));
  const amountish = numbers.filter((n) => !/^(19|20)\d{2}$/u.test(n));
  if (amountish.length) {
    const taka = Number(amountish[0]);
    if (Number.isFinite(taka) && taka > 0) {
      q.amountPaisa = Math.round(taka * 100);
      // Someone who says "about five hundred" does not mean 500.00 exactly. One percent,
      // or one taka, whichever is larger — enough to catch 499 and 502, not 550.
      q.tolerancePaisa = Math.max(100, Math.round(q.amountPaisa * 0.01));
    }
  }

  // ── the period ─────────────────────────────────────────────────────────────
  const year = now.getFullYear();
  const namedYear = ascii.match(/\b(19|20)\d{2}\b/u)?.[0];
  const month = MONTHS.find(([re]) => re.test(raw))?.[1];
  const lastYear = /গত ?বছর|গতবছর|last year|previous year/iu.test(raw);
  const thisYear = /এ ?বছর|এই ?বছর|this year|চলতি বছর/iu.test(raw);
  const lastMonth = /গত ?মাস|গতমাস|last month|আগের মাস/iu.test(raw);
  const thisMonth = /এ ?মাস|এই ?মাস|this month|চলতি মাস/iu.test(raw);
  const lastWeek = /গত ?সপ্তাহ|last week/iu.test(raw);
  // No `\b` around the Bengali: a word boundary is defined against `\w`, which Bengali
  // letters are not, so `আজ\b` matched nothing and "আজকে কত খরচ" fell through to no period
  // at all. "গতকাল" is checked first because it contains "কাল", not "আজ", but the reverse
  // trap — "আজ" inside a longer word — is what the trailing group covers.
  const yesterday = /গতকাল|yesterday/iu.test(raw);
  const today = !yesterday && /আজকে|আজ\s|আজ$|(?<![a-z])today/iu.test(raw);

  const day = (d: Date) => bangladeshDateKey(d);
  const shifted = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 6));

  if (today) { q.from = day(now); q.to = day(now); }
  else if (yesterday) { const d = new Date(now.getTime() - 86_400_000); q.from = day(d); q.to = day(d); }
  else if (lastWeek) { q.from = day(new Date(now.getTime() - 7 * 86_400_000)); q.to = day(now); }
  else if (month !== undefined) {
    // A month name, in whichever year the question implies.
    const y = namedYear ? Number(namedYear) : lastYear ? year - 1 : year;
    q.from = day(shifted(y, month, 1));
    q.to = day(shifted(y, month + 1, 0));
  } else if (namedYear) { q.from = `${namedYear}-01-01`; q.to = `${namedYear}-12-31`; }
  else if (lastYear) { q.from = `${year - 1}-01-01`; q.to = `${year - 1}-12-31`; }
  else if (thisYear) { q.from = `${year}-01-01`; q.to = day(now); }
  else if (lastMonth) {
    q.from = day(shifted(year, now.getMonth() - 1, 1));
    q.to = day(shifted(year, now.getMonth(), 0));
  } else if (thisMonth) { q.from = day(shifted(year, now.getMonth(), 1)); q.to = day(now); }

  // ── the kind ───────────────────────────────────────────────────────────────
  const matchedType = TYPE_WORDS.find(([re]) => re.test(raw));
  if (matchedType) q.types = matchedType[1];

  // ── is it asking for a total ───────────────────────────────────────────────
  //
  // "মোট কত", "সব মিলিয়ে", "how much in total" — and the bare "কত ... খরচ" with no sum
  // named, which is the commonest way of all to ask it. A question that names a sum is
  // never a total: naming one means looking for it.
  const wantsTotal = /মোট|সব মিলিয়ে|সবমিলিয়ে|কত টাকা|in total|altogether|how much|total/iu.test(raw);
  if (wantsTotal && q.amountPaisa === undefined) q.aggregate = true;

  // What is left once the numbers and the kind-words are removed — a person's name, a
  // shop, a category the user invented.
  //
  // The kind-word has to come out. "কোথায় খরচ করেছি" already became a filter on every
  // outgoing type; leaving "খরচ" in the leftovers made it *also* demand the word "খরচ"
  // appear in the record's own text, and a grocery bill filed as "বাজার" says no such
  // thing. One phrase must not narrow the query twice.
  let leftover = raw.replace(/[০-৯\d]+/gu, ' ');
  if (matchedType) leftover = leftover.replace(new RegExp(matchedType[0].source, 'giu'), ' ');
  // The period words go for the same reason: "last year" is already the date filter, and
  // no record has the words "last year" written inside it.
  leftover = leftover.replace(PERIOD_WORDS, ' ').replace(/\s+/gu, ' ').trim();
  if (leftover) q.text = leftover;

  return q;
}

/**
 * Every phrase that already became a date filter.
 *
 * Kept beside the parsing that reads them so the two lists cannot drift: anything added
 * above as a period has to be removed here, or it narrows the query a second time as if
 * it were the name of a shop.
 */
const PERIOD_WORDS = /গত ?বছর|গতবছর|এ ?বছর|এই ?বছর|চলতি বছর|গত ?মাস|গতমাস|আগের মাস|এ ?মাস|এই ?মাস|চলতি মাস|গত ?সপ্তাহ|গতকাল|আজকে|আজ|সালে|last year|previous year|this year|last month|this month|last week|yesterday|today|জানু\S*|ফেব্রু\S*|মার্চ|এপ্রিল|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর|january|february|march|april|june|july|august|september|october|november|december/giu;

/**
 * Words that appear in questions and never in records.
 *
 * Without this "কত টাকা খরচ করেছি" would try to find an event whose title contains
 * "করেছি" and answer nothing. Only the words that carry no information about *what* —
 * question words, verbs of asking, the currency itself.
 */
const STOP_WORDS = new Set([
  'কত', 'কি', 'কী', 'কোথায়', 'কোন', 'কেন', 'কবে', 'কারা', 'কাকে', 'কার',
  'টাকা', 'করেছি', 'করেছিলাম', 'হয়েছে', 'হয়েছিল', 'ছিল', 'গেল', 'গেছে', 'দিয়েছি',
  'আমি', 'আমার', 'সালে', 'তারিখে', 'মাসে', 'বছর', 'বছরে', 'মাস', 'দিন', 'বাবদ', 'বাবদে', 'খাতে',
  // The words that asked for a total. They became `aggregate`; leaving them in would
  // also demand a record whose title contains "মোট", and none does.
  'মোট', 'সব', 'মিলিয়ে', 'সবমিলিয়ে', 'total', 'altogether', 'sum',
  // Conversational filler that opens a follow-up: "আর গত বছর?"
  'আর', 'তার', 'আগের', 'and', 'about', 'then',
  'what', 'where', 'when', 'why', 'which', 'how', 'much', 'many', 'did', 'was', 'were',
  'taka', 'spend', 'spent', 'the', 'and', 'for', 'from', 'that', 'this', 'have', 'has',
]);

/**
 * A follow-up, read in the light of the question before it.
 *
 * "গত মাসে চিকিৎসায় কত?" then "আর তার আগের মাসে?" — the second names a period and
 * nothing else, and answering it as a bare period question would sum the whole month
 * instead of the medical part of it. So what the follow-up *does* say always wins, and
 * only the parts it left out are inherited.
 *
 * The period is the exception that is never inherited on its own: a question that names a
 * new period means a new period, and one that names none means the same one as before.
 * That is already what "fill only the gaps" does — it is written down because getting it
 * backwards would silently answer about the wrong month.
 */
export function asFollowUp(now: MoneyQuestion, before: MoneyQuestion | undefined): MoneyQuestion {
  if (!before) return now;
  // A question that stands on its own is not a follow-up at all.
  const namesSubject = Boolean(now.types?.length || now.person || now.amountPaisa !== undefined || meaningfulWords(now.text).length);
  const namesPeriod = now.from !== undefined;
  if (namesSubject && namesPeriod) return now;

  return {
    ...now,
    types: now.types?.length ? now.types : before.types,
    person: now.person ?? before.person,
    text: now.text ?? before.text,
    from: now.from ?? before.from,
    to: now.to ?? before.to,
    // The sum is deliberately not inherited: "গত মাসে?" after "৫০০ টাকা কোথায় গেল" is
    // asking about last month, not about five hundred taka in last month.
    amountPaisa: now.amountPaisa,
    tolerancePaisa: now.tolerancePaisa,
    aggregate: now.aggregate ?? before.aggregate,
  };
}

/**
 * The words in a question that could actually match a record.
 *
 * Shared by the filter and by the follow-up logic, because they have to agree on what
 * counts as saying something: "আর গত বছর?" leaves the word "আর" behind, and treating that
 * as a subject made the follow-up look self-contained and lose the thread.
 */
function meaningfulWords(text: string | undefined): string[] {
  return (text ?? '')
    .split(/[\s,।!?.]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()));
}

/** Enough of a question to be worth running. A bare "what happened" is not. */
export function isAnswerable(q: MoneyQuestion): boolean {
  return q.amountPaisa !== undefined
    || q.from !== undefined
    || (q.types?.length ?? 0) > 0
    || q.aggregate === true;
}

type Row = {
  id: string; type: string; occurred_at: string; title: string | null; person_name: string | null;
  place: string | null; purpose: string | null; source: string | null; destination: string | null;
  amount_paisa: number | null; note: string | null; created_at: string;
};

const SELECT = `SELECT e.id, e.type, e.occurred_at, e.title, p.name AS person_name, e.place,
                       e.purpose, e.source, e.destination, e.amount_paisa, e.note, e.created_at
                  FROM life_events e
                  LEFT JOIN people p ON p.id = e.person_id`;

export type QueryMatch = LifeEvent & { personName: string | null };

/**
 * Everything that fits the question, nearest sum first.
 *
 * Ordered by how close the amount is rather than by date, because someone who names a sum
 * is looking for that payment — an exact match three years back is a better answer than an
 * approximate one from last week.
 */
/**
 * The filter both answers are built from.
 *
 * Shared rather than written twice because a total and a list that disagree about what
 * they counted is the worst possible outcome here: the figure would be right about a set
 * of records the user is not being shown.
 */
function buildWhere(q: MoneyQuestion): { clause: string; args: (string | number)[] } {
  const where = ['e.deleted_at IS NULL'];
  const args: (string | number)[] = [];

  if (q.amountPaisa !== undefined) {
    const slack = q.tolerancePaisa ?? 0;
    where.push('e.amount_paisa IS NOT NULL AND e.amount_paisa BETWEEN ? AND ?');
    args.push(q.amountPaisa - slack, q.amountPaisa + slack);
  }
  if (q.from) { where.push('substr(e.occurred_at, 1, 10) >= ?'); args.push(q.from); }
  if (q.to) { where.push('substr(e.occurred_at, 1, 10) <= ?'); args.push(q.to); }
  if (q.types?.length) {
    where.push(`e.type IN (${q.types.map(() => '?').join(',')})`);
    args.push(...q.types);
  }
  if (q.person) { where.push('p.name LIKE ?'); args.push(`%${q.person}%`); }

  // ── the words the user's own records are written in ────────────────────────
  //
  // Whatever is left of the question after the sum and the dates come out is the part no
  // vocabulary here could ever cover: a shop, a person, a category they invented. It is
  // matched against the event's own text rather than against any list, which is how the
  // app learns a household's language without being taught it — someone who files things
  // under "বাজার" can ask about বাজার from the day they first type it.
  //
  // Only words long enough to mean something, and only as a narrowing: a question whose
  // leftovers match nothing still answers on the sum and the date alone.
  const words = meaningfulWords(q.text);

  if (words.length) {
    const clauses = words.map(() =>
      '(e.title LIKE ? OR e.note LIKE ? OR e.place LIKE ? OR e.destination LIKE ? OR e.source LIKE ? OR p.name LIKE ?)');
    // Any one of them, not all: people type more words than their records contain.
    where.push(`(${clauses.join(' OR ')})`);
    for (const w of words) for (let i = 0; i < 6; i += 1) args.push(`%${w}%`);
  }

  return { clause: where.join(' AND '), args };
}

/**
 * Everything that fits the question, nearest sum first.
 *
 * Ordered by how close the amount is rather than by date, because someone who names a sum
 * is looking for that payment — an exact match three years back is a better answer than an
 * approximate one from last week.
 */
export async function findEvents(db: SQLiteDatabase, q: MoneyQuestion, limit = 25): Promise<QueryMatch[]> {
  const { clause, args } = buildWhere(q);
  const order = q.amountPaisa !== undefined
    ? `ORDER BY ABS(e.amount_paisa - ${Math.round(q.amountPaisa)}) ASC, e.occurred_at DESC`
    : 'ORDER BY e.occurred_at DESC';

  const rows = await db.getAllAsync<Row>(`${SELECT} WHERE ${clause} ${order} LIMIT ?`, ...args, limit);
  return rows.map((r) => ({
    id: r.id, type: r.type, occurredAt: r.occurred_at, title: r.title, personId: null,
    personName: r.person_name, place: r.place, purpose: r.purpose, source: r.source,
    destination: r.destination, amountPaisa: r.amount_paisa, note: r.note, createdAt: r.created_at,
  }));
}

/**
 * One sentence saying what was found, before the list of it.
 *
 * The app answers in words because the question was asked in words. It never rounds and
 * never summarises away a difference: when three things match, it says three, and the
 * list underneath is what actually settles it.
 */
export function describeAnswer(q: MoneyQuestion, matches: QueryMatch[], language: AppLanguage): string {
  const bn = language === 'bn';
  const n = matches.length;
  if (n === 0) {
    return bn ? 'এই শর্তে কিছু পাওয়া যায়নি।' : 'Nothing matches that.';
  }

  const first = matches[0]!;
  const what = eventTypeLabel(first.type, language);
  const where = [first.title?.trim(), first.personName, eventWord(first.destination, language)]
    .filter(Boolean)[0];
  const sum = first.amountPaisa ? formatPaisa(first.amountPaisa, { symbol: true, bnDigits: bn }) : null;
  const day = first.occurredAt.slice(0, 10);

  if (n === 1) {
    return bn
      ? `একটি পাওয়া গেছে — ${day} তারিখে ${sum ?? ''} ${what}${where ? `, ${where}` : ''}।`
      : `One match — ${what.toLowerCase()}${sum ? ` of ${sum}` : ''} on ${day}${where ? `, ${where}` : ''}.`;
  }
  return bn
    ? `${n}টি পাওয়া গেছে। সবচেয়ে কাছেরটি ${day} তারিখে ${sum ?? ''} ${what}${where ? `, ${where}` : ''}।`
    : `${n} matches. The closest is ${what.toLowerCase()}${sum ? ` of ${sum}` : ''} on ${day}${where ? `, ${where}` : ''}.`;
}

/** What a "how much altogether" question is answered with. */
export interface Totals {
  totalPaisa: number;
  count: number;
  /** Broken down by kind, largest first, so "on what" is answered alongside "how much". */
  byType: { type: string; totalPaisa: number; count: number }[];
}

/**
 * One figure for everything that matches, and the shape of it underneath.
 *
 * Deliberately a second query rather than a sum over `findEvents`, which is capped at a
 * page of rows: a year of groceries is more than twenty-five records, and a total that
 * quietly only counted the first twenty-five would be worse than no total at all.
 */
export async function totalFor(db: SQLiteDatabase, q: MoneyQuestion): Promise<Totals> {
  const { clause, args } = buildWhere(q);
  const rows = await db.getAllAsync<{ type: string; total: number; n: number }>(
    `SELECT e.type, COALESCE(SUM(e.amount_paisa), 0) AS total, COUNT(*) AS n
       FROM life_events e
       LEFT JOIN people p ON p.id = e.person_id
      WHERE ${clause} AND e.amount_paisa IS NOT NULL
      GROUP BY e.type
      ORDER BY total DESC`,
    ...args,
  );
  const byType = rows.map((r) => ({ type: r.type, totalPaisa: Number(r.total), count: Number(r.n) }));
  return {
    totalPaisa: byType.reduce((sum, r) => sum + r.totalPaisa, 0),
    count: byType.reduce((sum, r) => sum + r.count, 0),
    byType,
  };
}

/** The sentence for a total. Says what it added up, not only what it came to. */
export function describeTotal(q: MoneyQuestion, totals: Totals, language: AppLanguage): string {
  const bn = language === 'bn';
  const money = (p: number) => formatPaisa(p, { symbol: true, bnDigits: bn });
  if (totals.count === 0) return bn ? 'এই শর্তে কিছু পাওয়া যায়নি।' : 'Nothing matches that.';

  const head = bn
    ? `সব মিলিয়ে ${money(totals.totalPaisa)} — ${totals.count}টি হিসাব।`
    : `${money(totals.totalPaisa)} altogether, across ${totals.count} record${totals.count === 1 ? '' : 's'}.`;

  // The two or three kinds that actually carry the figure. A breakdown listing seven
  // kinds where one of them is 94% of the total explains nothing.
  const top = totals.byType.slice(0, 3)
    .map((r) => `${eventTypeLabel(r.type, language)} ${money(r.totalPaisa)}`)
    .join(' · ');
  return top ? `${head}\n${top}` : head;
}

/**
 * Ask a question in words, get the answer and the records it rests on.
 *
 * A question asking for a total gets the total *and* the records: the figure is the
 * answer, and the rows underneath are how anyone checks it. Nothing here ever states a
 * sum the user cannot then go and look at.
 */
export async function askAboutMoney(
  db: SQLiteDatabase,
  question: string,
  language: AppLanguage,
  now = new Date(),
  /** What was asked just before, so a terse follow-up keeps the subject. */
  previous?: MoneyQuestion,
): Promise<{ parsed: MoneyQuestion; matches: QueryMatch[]; answer: string; totals?: Totals } | null> {
  const parsed = asFollowUp(parseMoneyQuestion(question, now), previous);
  if (!isAnswerable(parsed)) return null;
  const matches = await findEvents(db, parsed);

  if (parsed.aggregate) {
    const totals = await totalFor(db, parsed);
    return { parsed, matches, totals, answer: describeTotal(parsed, totals, language) };
  }
  return { parsed, matches, answer: describeAnswer(parsed, matches, language) };
}
