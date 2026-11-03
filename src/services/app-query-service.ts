import type { SQLiteDatabase } from 'expo-sqlite';
import type { CommandTopic, QueryTopic, ScreenId } from '../ai/capabilities';
import { getDailyPlan, planInboxTasks } from './planning-service';
import { getPortfolio } from './debt/debt-service';
import { formatPaisa , asciiDigitsToBengali } from './debt/money';
import { onHandBreakdown } from './wallet-service';
import { categoryBreakdown, fundSourceLabel, monthKey, repaymentBySource, spendingBySource, summariseMonth, type SourceTotal } from './finance-service';
import { ensureDosesForDay, listDoses, missedDoses, nextDose, setDoseStatus, upcomingHealth, type Dose } from './health-service';
import { searchAll } from './unified-search-service';
import { explainNoDose, pickDose } from './dose-pick';
import { runDiagnostics } from './diagnostics-service';
import { getNotificationStatus } from './notification-status-service';
import { runAutoBackup, LAST_AUTO_BACKUP_KEY } from './auto-backup-service';
import { getPreferredEngineId } from '../ai/engine/registry';
import { onDeviceLlmEngine } from '../ai/engine/on-device-llm-engine';
import { loadInstalledModel } from '../ai/model/model-manager';
import { lastLoadDidNotFinish } from '../ai/model/llama-runtime';
import { lastLlmIssue, llmIssueCopy } from '../ai/model/llm-health';
import { bangladeshDateKey, formatBangladeshDate, formatBangladeshDateTime, formatBangladeshTime, formatBangladeshWeekdayDate, formatDayKey, timeZoneLabel } from '../i18n/date-time';
import { guideAnswer, type GuideTopic } from '../ai/app-guide';
import { aboutAponAnswer, type AboutTopic } from '../ai/about-apon';

// The Assistant's reach into every other part of the app. Each answer is built only from
// what the app has stored — never estimated — and says where to look for the rest
// (`open`), so a short reply in the chat is never the end of the road.

export interface AppReply {
  text: string;
  /** The screen that holds the full picture, offered as a button under the reply. */
  open?: ScreenId;
  trace: string[];
}

type Lang = 'bn' | 'en';

const num = (value: number, bn: boolean) => (bn ? asciiDigitsToBengali(String(value)) : String(value));
const taka = (paisa: number, bn: boolean) => formatPaisa(paisa, { symbol: true, bnDigits: bn });
const list = <T>(items: T[], line: (item: T) => string, max = 5, bn = true) =>
  [...items.slice(0, max).map((i) => `• ${line(i)}`), ...(items.length > max ? [bn ? `…আরও ${num(items.length - max, bn)}টি` : `…and ${items.length - max} more`] : [])].join('\n');

async function readPreference(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', key).catch(() => null);
  return row?.value || null;
}

// ── queries ──────────────────────────────────────────────────────────────────────────

async function planToday(db: SQLiteDatabase, bn: boolean): Promise<AppReply> {
  const plan = await getDailyPlan(db);
  const when = (dueAt: string | null) => (dueAt ? ` — ${formatBangladeshTime(dueAt, bn ? 'bn' : 'en')}` : '');
  const parts: string[] = [];
  if (plan.overdue.length) parts.push((bn ? `⚠ সময় পেরিয়ে গেছে (${num(plan.overdue.length, bn)}):\n` : `⚠ Overdue (${plan.overdue.length}):\n`) + list(plan.overdue, (t) => t.title, 5, bn));
  if (plan.scheduled.length) parts.push((bn ? `📅 আজকের কাজ (${num(plan.scheduled.length, bn)}):\n` : `📅 Today (${plan.scheduled.length}):\n`) + list(plan.scheduled, (t) => `${t.title}${when(t.dueAt)}`, 6, bn));
  if (plan.inbox.length) parts.push(bn ? `📥 ইনবক্সে ${num(plan.inbox.length, bn)}টি কাজ এখনো কোনো দিনে রাখা হয়নি — "ইনবক্সের কাজগুলো আজকের প্ল্যানে দাও" বললে আজকে রেখে দেব।` : `📥 ${plan.inbox.length} inbox task(s) have no day yet — say "plan my inbox for today" to put them on today.`);
  const text = parts.length
    ? parts.join('\n\n')
    : (bn ? 'আজকের জন্য কোনো কাজ নেই, পেছনে বাকিও নেই। 🎉' : 'Nothing planned for today and nothing overdue. 🎉');
  return { text, open: 'planning', trace: ['app-query:plan-today', `overdue:${plan.overdue.length}`, `today:${plan.scheduled.length}`, `inbox:${plan.inbox.length}`] };
}

/**
 * "কালকে কী কাজ আছে", "এই সপ্তাহের কাজ", "সময় পেরোনো কাজ" (rc.13 #9) — read from the same
 * daily plan the Planning page shows, one day at a time, so the two can never disagree.
 */
async function planAhead(db: SQLiteDatabase, bn: boolean, span: 'tomorrow' | 'week' | 'overdue'): Promise<AppReply> {
  const trace = ['app-query:plan-ahead', span];
  if (span === 'overdue') {
    const { overdue } = await getDailyPlan(db);
    return {
      text: overdue.length
        ? (bn ? `⚠ সময় পেরিয়ে গেছে (${num(overdue.length, bn)}):\n` : `⚠ Overdue (${overdue.length}):\n`) + list(overdue, (t) => t.title, 8, bn)
          + (bn ? '\nকোনোটা অন্য দিনে সরাতে বলুন: "…কাজটা কালকে সরিয়ে দাও"।' : '\nTo move one, say: "move … to tomorrow".')
        : (bn ? 'সময় পেরোনো কোনো কাজ নেই। 🎉' : 'Nothing is overdue. 🎉'),
      open: 'planning', trace,
    };
  }
  const days = span === 'tomorrow' ? [1] : [0, 1, 2, 3, 4, 5, 6];
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const offset of days) {
    const day = new Date(Date.now() + offset * 86_400_000);
    const { scheduled } = await getDailyPlan(db, day);
    const fresh = scheduled.filter((t) => !seen.has(t.id));
    fresh.forEach((t) => seen.add(t.id));
    if (!fresh.length) continue;
    const at = (dueAt: string | null) => (dueAt ? ` — ${formatBangladeshTime(dueAt, bn ? 'bn' : 'en')}` : '');
    const head = span === 'tomorrow' ? '' : `${formatBangladeshWeekdayDate(day, bn ? 'bn' : 'en')}:\n`;
    parts.push(head + list(fresh, (t) => `${t.title}${at(t.dueAt)}`, 6, bn));
  }
  const empty = span === 'tomorrow'
    ? (bn ? 'কালকের জন্য কোনো কাজ রাখা নেই।\nযোগ করতে বলুন: "কাল সকাল ১০টায় ব্যাংকে যাব"।' : 'Nothing planned for tomorrow.\nTo add one, say: "bank tomorrow at 10am".')
    : (bn ? 'এই সপ্তাহে কোনো কাজ রাখা নেই।' : 'Nothing planned this week.');
  const title = span === 'tomorrow' ? (bn ? '📅 কালকের কাজ:\n' : '📅 Tomorrow:\n') : (bn ? '📅 এই সপ্তাহের কাজ:\n\n' : '📅 This week:\n\n');
  return { text: parts.length ? title + parts.join('\n\n') : empty, open: 'planning', trace: [...trace, `tasks:${seen.size}`] };
}

async function debts(db: SQLiteDatabase, bn: boolean, person?: string): Promise<AppReply> {
  const portfolio = await getPortfolio(db);
  const nameOf = (personId: string) => portfolio.people.find((p) => p.id === personId)?.name ?? '';
  const rows = portfolio.balances
    .map((b) => ({ b, account: portfolio.accounts.find((a) => a.id === b.accountId) }))
    .filter((r): r is { b: typeof r.b; account: NonNullable<typeof r.account> } => !!r.account && r.b.remainingPaisa > 0);

  if (person) {
    // T14: "রহিমের", "রহিমকে", "রহিম ভাই" all name রহিম. Endings and honorifics come off
    // both sides; nothing else is guessed — another spelling stays a question, not an answer.
    const CASE_END = /(?:ের|এর|কে|র|টা|টি)$/u;
    const wanted = person.toLocaleLowerCase()
      .replace(/\s+(?:আপা|ভাই|ভাইয়া|সাহেব|সাব|দাদা|দিদি|খালা|চাচা|মামা|কাকা|আন্টি|আঙ্কেল)$/u, '')
      .trim()
      .replace(CASE_END, '');
    // "রহিম" is রহিম, not রহিমা আপা. Only an exact name (honorific dropped) counts; a near
    // name is offered back as a question, never silently answered for.
    const HONORIFIC = /\s+(?:আপা|ভাই|ভাইয়া|সাহেব|সাব|দাদা|দিদি|খালা|চাচা|মামা|কাকা|আন্টি|আঙ্কেল)$/u;
    const bare = (n: string) => n.toLocaleLowerCase().replace(HONORIFIC, '').trim();
    const isExact = (n: string) => {
      const full = bare(n);
      const first = full.split(/\s+/u)[0] ?? '';
      return full === wanted || first === wanted || first.replace(CASE_END, '') === wanted;
    };
    const mine = rows.filter((r) => isExact(nameOf(r.account.personId)));
    const people = [...new Set(mine.map((r) => r.account.personId))];
    const sumFor = (pid: string, direction: 'DEBT' | 'RECEIVABLE') => rows.filter((r) => r.account.personId === pid && r.account.direction === direction).reduce((s, r) => s + r.b.remainingPaisa, 0);
    const line = (pid: string) => {
      const owed = sumFor(pid, 'RECEIVABLE'); const owe = sumFor(pid, 'DEBT');
      return `${nameOf(pid)}: ${[owed ? (bn ? `পাবেন ${taka(owed, bn)}` : `owes you ${taka(owed, bn)}`) : '', owe ? (bn ? `দেবেন ${taka(owe, bn)}` : `you owe ${taka(owe, bn)}`) : ''].filter(Boolean).join(', ')}`;
    };
    if (people.length > 1) {
      return { text: (bn ? `"${person}" নামে ${num(people.length, bn)} জন আছেন:\n` : `${people.length} people are named "${person}":\n`) + list(people, line, 6, bn), open: 'debt', trace: ['app-query:debt-person', `people:${people.length}`] };
    }
    if (!mine.length) {
      const near = [...new Set(rows.filter((r) => nameOf(r.account.personId).toLocaleLowerCase().includes(wanted)).map((r) => r.account.personId))];
      if (near.length) {
        return {
          // Said first and plainly: the exact name is not there. The near names follow as a
          // separate list, never as an answer for the person asked about (rc.13 QA H04).
          text: (bn ? `"${person}" নামে ঠিক কারো হিসাব নেই।\n\nকাছাকাছি নাম (এঁদের কারো কথা বলছেন?):\n` : `No account for exactly "${person}".\n\nClose names (did you mean one of them?):\n`) + list(near, line, 4, bn)
            + (bn ? '\nএঁদের কারো কথা বললে পুরো নামটা লিখুন।' : '\nIf you meant one of them, type the full name.'),
          open: 'debt', trace: ['app-query:debt-person', 'exact:0', `near:${near.length}`],
        };
      }
    }
    if (!mine.length) {
      const known = portfolio.people.some((p) => p.name.toLocaleLowerCase().includes(wanted));
      return {
        text: known
          ? (bn ? `${person}-এর সাথে এখন কোনো বকেয়া হিসাব নেই — সব মিটে গেছে।` : `Nothing is outstanding with ${person} — all settled.`)
          : (bn ? `"${person}" নামে কারো সাথে দেনা-পাওনার হিসাব পাইনি।` : `No debt record with anyone named "${person}".`),
        open: 'debt', trace: ['app-query:debt-person', 'matched:0'],
      };
    }
    const owedToMe = mine.filter((r) => r.account.direction === 'RECEIVABLE').reduce((s, r) => s + r.b.remainingPaisa, 0);
    const iOwe = mine.filter((r) => r.account.direction === 'DEBT').reduce((s, r) => s + r.b.remainingPaisa, 0);
    const name = nameOf(mine[0]!.account.personId);
    const lines = [
      owedToMe ? (bn ? `${name} আপনাকে দেবেন ${taka(owedToMe, bn)}` : `${name} owes you ${taka(owedToMe, bn)}`) : '',
      iOwe ? (bn ? `আপনি ${name}-কে দেবেন ${taka(iOwe, bn)}` : `You owe ${name} ${taka(iOwe, bn)}`) : '',
    ].filter(Boolean);
    return { text: lines.join('\n'), open: 'debt', trace: ['app-query:debt-person', `accounts:${mine.length}`] };
  }

  if (!rows.length) return { text: bn ? 'এখন কোনো বকেয়া দেনা বা পাওনা নেই।' : 'No outstanding debts or money owed to you.', open: 'debt', trace: ['app-query:debt-summary', 'accounts:0'] };
  const top = (direction: 'DEBT' | 'RECEIVABLE') => rows.filter((r) => r.account.direction === direction)
    .sort((a, b) => b.b.remainingPaisa - a.b.remainingPaisa)
    .map((r) => `${nameOf(r.account.personId) || r.account.title || '—'}: ${taka(r.b.remainingPaisa, bn)}`);
  const iOwe = top('DEBT');
  const owed = top('RECEIVABLE');
  const parts = [
    bn ? `আপনার মোট দেনা ${taka(portfolio.outstandingDebtPaisa, bn)}, মোট পাওনা ${taka(portfolio.outstandingReceivablePaisa, bn)}।`
      : `You owe ${taka(portfolio.outstandingDebtPaisa, bn)} in total and are owed ${taka(portfolio.outstandingReceivablePaisa, bn)}.`,
    iOwe.length ? (bn ? 'যাদের দেবেন:\n' : 'You owe:\n') + list(iOwe, (s) => s, 4, bn) : '',
    owed.length ? (bn ? 'যাদের কাছে পাবেন:\n' : 'Owed to you by:\n') + list(owed, (s) => s, 4, bn) : '',
    portfolio.overdueCount ? (bn ? `⚠ ${num(portfolio.overdueCount, bn)}টি কিস্তির সময় পেরিয়ে গেছে (${taka(portfolio.overduePaisa, bn)})।` : `⚠ ${portfolio.overdueCount} instalment(s) overdue (${taka(portfolio.overduePaisa, bn)}).`) : '',
  ].filter(Boolean);
  return { text: parts.join('\n\n'), open: 'debt', trace: ['app-query:debt-summary', `accounts:${rows.length}`] };
}

async function balance(db: SQLiteDatabase, bn: boolean): Promise<AppReply> {
  // The same on-hand figure the wallet page shows, with the same parts (RC.4 QA).
  const { wallets, archivedPaisa, unassignedPaisa, totalPaisa } = await onHandBreakdown(db);
  if (!wallets.length && !unassignedPaisa && !archivedPaisa) return { text: bn ? 'কোনো মানিব্যাগ এখনো যোগ করা হয়নি — মানিব্যাগ পাতা থেকে যোগ করলে হাতের টাকার হিসাব বলতে পারব।' : 'No wallets yet — add one on the Wallets screen and I can tell you what is on hand.', open: 'wallets', trace: ['app-query:balance', 'wallets:0'] };
  const parts = [
    ...wallets.map((w) => ({ name: w.name, paisa: w.balancePaisa })),
    ...(unassignedPaisa ? [{ name: bn ? 'মানিব্যাগ ছাড়া লেখা হিসাব' : 'No wallet chosen', paisa: unassignedPaisa }] : []),
    ...(archivedPaisa ? [{ name: bn ? 'বন্ধ করা মানিব্যাগ' : 'Put-away wallets', paisa: archivedPaisa }] : []),
  ];
  const text = (bn ? `সব মিলিয়ে হাতে আছে ${taka(totalPaisa, bn)}:\n` : `On hand in total: ${taka(totalPaisa, bn)}\n`)
    + list(parts, (p) => `${p.name}: ${taka(p.paisa, bn)}`, 8, bn);
  return { text, open: 'wallets', trace: ['app-query:balance', `wallets:${wallets.length}`] };
}

/**
 * "এই মাসে কত খরচ হয়েছে?" — answered from the same two functions the money page uses
 * (summariseMonth, categoryBreakdown), so আপন and the page can never give two numbers.
 * Transfers and loan movements are left out, exactly as on the page.
 */
async function moneyMonth(db: SQLiteDatabase, bn: boolean, subject?: string): Promise<AppReply> {
  const [when = 'this', what = ''] = (subject ?? 'this').split('|');
  const now = new Date();
  const month = when === 'last' ? monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 15)) : monthKey(now);
  const [y, m] = month.split('-').map(Number);
  const monthName = formatBangladeshDate(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 15)), bn ? 'bn' : 'en').replace(/^[^\d০-৯]*[\d০-৯]+\s*/u, '').replace(',', '').trim();
  const [sum, cats] = await Promise.all([summariseMonth(db, month), categoryBreakdown(db, 'EXPENSE', month)]);
  const sourceName = (s: SourceTotal) => (s.source ? fundSourceLabel(s.source, bn) : (bn ? 'উৎস জানা নেই' : 'source not known'));
  // Whose money paid: the same rows the money page's source card reads, so the two agree.
  if (what === 'উৎস') {
    const [spend, repay] = await Promise.all([spendingBySource(db, month), repaymentBySource(db, month)]);
    if (!spend.length && !repay.length) {
      return {
        text: bn
          ? `${monthName}-এ কোনো খরচ বা ঋণ শোধ লেখা নেই।\nখরচ লেখার সময় "টাকার উৎস" বেছে দিলে এখানে দেখাবে কোন টাকা থেকে খরচ হলো।`
          : `Nothing spent or repaid in ${monthName}.\nPick the source when you record spending, and this shows whose money paid.`,
        open: 'finance', trace: ['app-query:money-month', 'source', 'empty'],
      };
    }
    const total = (xs: SourceTotal[]) => xs.reduce((n, x) => n + x.totalPaisa, 0);
    const loanToLoan = repay.find((r) => r.source === 'LOAN')?.totalPaisa ?? 0;
    const unknown = (spend.find((r) => r.source === null)?.totalPaisa ?? 0) + (repay.find((r) => r.source === null)?.totalPaisa ?? 0);
    const parts: string[] = [];
    if (spend.length) {
      parts.push((bn ? `${monthName}-এ খরচ ${taka(total(spend), bn)} — কোন টাকা থেকে:` : `Spent in ${monthName}: ${taka(total(spend), bn)} — whose money:`)
        + '\n' + list(spend, (r) => `${sourceName(r)}: ${taka(r.totalPaisa, bn)}`, 6, bn));
    }
    if (repay.length) {
      // A repayment is not spending — it is left out of the month's spending total, exactly
      // as on the money page. Said in words, so the two lists are never added together into
      // a total that matches nothing (rc.13 QA H03: ৳39,620 vs ৳40,120).
      parts.push((bn ? `এর বাইরে ঋণ শোধ ${taka(total(repay), bn)} — কোন টাকা থেকে:` : `Separately, loans repaid: ${taka(total(repay), bn)} — whose money:`)
        + '\n' + list(repay, (r) => `${sourceName(r)}: ${taka(r.totalPaisa, bn)}`, 6, bn)
        + (bn ? '\nঋণ শোধ খরচ নয় (দেনা কমেছে), তাই মোট খরচে ধরা হয়নি।' : '\nRepaying is not spending (a debt went down), so it is not in the spending total.'));
    }
    if (loanToLoan > 0) parts.push(bn ? `ঋণ দিয়ে ঋণ শোধ: ${taka(loanToLoan, bn)}` : `Loans repaid with borrowed money: ${taka(loanToLoan, bn)}`);
    if (unknown > 0) {
      parts.push(bn
        ? `${taka(unknown, bn)}-এর উৎস লেখা নেই — আয়-ব্যয় → "হিসাব ঠিক করুন" থেকে বসিয়ে দিলে পুরো হিসাব মিলবে।`
        : `${taka(unknown, bn)} has no source yet — set it from Money → "Fix records" and the picture is complete.`);
    }
    return { text: parts.join('\n\n'), open: 'finance', trace: ['app-query:money-month', 'source', month] };
  }
  if (what) {
    const words = what === 'চিকিৎসা' ? /(?:চিকিৎসা|ওষুধ|ঔষধ|ডাক্তার|হাসপাতাল|স্বাস্থ্য|টেস্ট|medical|medicine|doctor|health)/iu : new RegExp(what.replace(/[.*+?^${}()|[\]\\]/gu, ''), 'iu');
    const hits = cats.filter((c) => words.test(c.category));
    const total = hits.reduce((s, c) => s + c.totalPaisa, 0);
    const label = what === 'চিকিৎসা' ? (bn ? 'চিকিৎসায়' : 'on health') : (bn ? `${what}-এ` : `on ${what}`);
    const text = !hits.length
      // T11: an empty answer is not the end of the conversation — the next step is offered,
      // in the person's own words, without inventing a single figure.
      ? (bn
        ? `${monthName}-এ ${label} কোনো খরচ লেখা নেই।\nচাইলে এখনই যোগ করতে পারেন — যেমন বলুন: "আজ ৫০০ টাকা ${what === 'চিকিৎসা' ? 'ডাক্তার দেখাতে' : what} খরচ"।`
        : `Nothing written ${label} in ${monthName}.\nYou can add one now — say, for example: "spent 500 ${label} today".`)
      : (bn ? `${monthName}-এ ${label} খরচ ${taka(total, bn)}।` : `Spent ${label} in ${monthName}: ${taka(total, bn)}.`)
        + (hits.length > 1 ? '\n' + list(hits, (c) => `${c.category}: ${taka(c.totalPaisa, bn)}`, 5, bn) : '');
    return { text, open: 'finance', trace: ['app-query:money-month', `category:${what}`] };
  }
  if (!sum.entryCount) {
    return {
      text: bn
        ? `${monthName}-এ এখনো কোনো আয় বা খরচ লেখা হয়নি।\nচাইলে এখনই লিখতে পারেন — যেমন বলুন: "আজ ৫০০ টাকা বাজার খরচ"।`
        : `Nothing written for ${monthName} yet.\nYou can start now — say, for example: "spent 500 on groceries today".`,
      open: 'finance',
      trace: ['app-query:money-month', 'empty'],
    };
  }
  const net = sum.incomePaisa - sum.expensePaisa;
  const head = bn
    ? `${monthName}-এ আয় ${taka(sum.incomePaisa, bn)}, খরচ ${taka(sum.expensePaisa, bn)} — আয় থেকে খরচ বাদে ${taka(net, bn)}।`
    : `${monthName}: income ${taka(sum.incomePaisa, bn)}, spending ${taka(sum.expensePaisa, bn)} — income minus spending ${taka(net, bn)}.`;
  const top = cats.slice(0, 3);
  const tail = top.length ? '\n' + (bn ? 'সবচেয়ে বেশি খরচ:\n' : 'Most spent on:\n') + list(top, (c) => `${c.category}: ${taka(c.totalPaisa, bn)}`, 3, bn) : '';
  // One line of whose money paid, when any of it is known — the full split is one question away.
  const spend = sum.expensePaisa > 0 ? await spendingBySource(db, month).catch(() => [] as SourceTotal[]) : [];
  const sources = spend.some((r) => r.source)
    ? '\n' + (bn ? 'কোন টাকা থেকে: ' : 'Whose money: ') + spend.map((r) => `${sourceName(r)} ${taka(r.totalPaisa, bn)}`).join(' · ')
    : '';
  return { text: head + tail + sources, open: 'finance', trace: ['app-query:money-month', month] };
}

const doseLine = (d: Dose, bn: boolean) => `${d.medicineName ?? (bn ? 'ওষুধ' : 'Medicine')} — ${formatBangladeshDateTime(d.dueAt, bn ? 'bn' : 'en')}`;

async function health(db: SQLiteDatabase, topic: 'HEALTH_NEXT_DOSE' | 'HEALTH_MISSED' | 'HEALTH_UPCOMING', lang: Lang): Promise<AppReply> {
  const bn = lang === 'bn';
  if (topic === 'HEALTH_NEXT_DOSE') {
    const dose = await nextDose(db);
    return {
      text: dose
        ? (bn ? `পরের ওষুধ: ${dose.medicineName ?? 'ওষুধ'}, ${formatBangladeshDateTime(dose.dueAt, 'bn')}।` : `Next dose: ${dose.medicineName ?? 'medicine'}, ${formatBangladeshDateTime(dose.dueAt, 'en')}.`)
        : (bn ? 'সামনে কোনো ওষুধের সময় নেই।' : 'No upcoming dose.'),
      open: 'health', trace: ['app-query:next-dose', dose ? 'found' : 'none'],
    };
  }
  if (topic === 'HEALTH_MISSED') {
    const missed = await missedDoses(db, 3);
    return {
      text: missed.length
        ? (bn ? `গত ৩ দিনে ${num(missed.length, bn)}টি ডোজ খাওয়া হয়নি বা লেখা হয়নি:\n` : `${missed.length} dose(s) in the last 3 days were not marked taken:\n`) + list(missed, (d) => doseLine(d, bn), 6, bn)
        : (bn ? 'গত ৩ দিনে কোনো ডোজ বাদ পড়েনি। 👍' : 'No missed doses in the last 3 days. 👍'),
      open: 'health', trace: ['app-query:missed-doses', `missed:${missed.length}`],
    };
  }
  const items = await upcomingHealth(db, lang, 30);
  return {
    text: items.length
      ? (bn ? 'সামনের ৩০ দিনে:\n' : 'In the next 30 days:\n') + list(items, (i) => `${i.title} — ${formatDayKey(i.dayKey, lang)}`, 6, bn)
      : (bn ? 'সামনের ৩০ দিনে কোনো ডাক্তার দেখানো, টেস্ট বা ওষুধ ফুরানোর তারিখ নেই।' : 'No doctor visit, test or refill due in the next 30 days.'),
    open: 'health', trace: ['app-query:upcoming-health', `items:${items.length}`],
  };
}

async function searchEverything(db: SQLiteDatabase, subject: string, lang: Lang): Promise<AppReply> {
  const bn = lang === 'bn';
  const found = await searchAll(db, subject, lang);
  const lines: string[] = [
    ...found.tasks.slice(0, 3).map((t) => `✅ ${t.title}`),
    ...found.memories.slice(0, 3).map((m) => `🧠 ${(m.title || m.content).slice(0, 80)}`),
    ...found.modules.flatMap((g) => g.hits.slice(0, 2).map((h) => `• ${h.title}${h.subtitle ? ` — ${h.subtitle}` : ''}`)),
  ];
  const count = found.tasks.length + found.memories.length + found.modules.reduce((s, g) => s + g.hits.length, 0);
  return {
    text: count
      ? (bn ? `"${subject}" — মোট ${num(count, bn)}টি পাওয়া গেছে:\n` : `"${subject}" — ${count} found:\n`) + lines.slice(0, 8).join('\n')
      : (bn ? `"${subject}" কোথাও পাইনি — কাজ, মেমোরি, হিসাব, মানুষ, স্বাস্থ্য সব জায়গায় দেখেছি।` : `Nothing found for "${subject}" — searched tasks, memories, money, people and health.`),
    open: 'search', trace: ['app-query:search-all', `hits:${count}`],
  };
}

async function appStatus(db: SQLiteDatabase, bn: boolean): Promise<AppReply> {
  const report = await runDiagnostics(db);
  const failed = report.checks.filter((c) => c.status === 'FAIL');
  const text = failed.length
    ? (bn ? `${num(report.checks.length, bn)}টি পরীক্ষার ${num(failed.length, bn)}টিতে সমস্যা:\n` : `${failed.length} of ${report.checks.length} checks failed:\n`) + list(failed, (c) => `${c.label} — ${c.detail}`, 5, bn)
    : (bn ? `✓ সব ঠিক আছে — ${num(report.passed, bn)}টি পরীক্ষা পাস${report.unknown ? `, ${num(report.unknown, bn)}টি এই মুহূর্তে যাচাই করা যায়নি` : ''}।` : `✓ All good — ${report.passed} checks passed${report.unknown ? `, ${report.unknown} could not be checked right now` : ''}.`);
  return { text, open: 'diagnostics', trace: ['app-query:app-status', `passed:${report.passed}`, `failed:${report.failed}`] };
}

async function reminderStatus(bn: boolean): Promise<AppReply> {
  const status = await getNotificationStatus();
  const upcoming = status.scheduled.filter((s) => s.dueAt).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  const text = !status.granted
    ? (bn ? '⚠ নোটিফিকেশনের অনুমতি বন্ধ — তাই রিমাইন্ডার আসবে না। অনুমতি পাতা থেকে চালু করুন।' : '⚠ Notification permission is off, so reminders will not appear. Turn it on from Permissions.')
    : (bn ? `✓ নোটিফিকেশন চালু। ${num(status.scheduled.length, bn)}টি রিমাইন্ডার সাজানো আছে।` : `✓ Notifications are on. ${status.scheduled.length} reminder(s) scheduled.`)
      + (upcoming[0] ? (bn ? `\nপরেরটি: ${upcoming[0].title} — ${formatBangladeshDateTime(upcoming[0].dueAt!, 'bn')}` : `\nNext: ${upcoming[0].title} — ${formatBangladeshDateTime(upcoming[0].dueAt!, 'en')}`) : '');
  return { text, open: status.granted ? 'reminders' : 'permissions', trace: ['app-query:reminder-status', `granted:${status.granted}`, `scheduled:${status.scheduled.length}`] };
}

async function aiStatus(db: SQLiteDatabase, bn: boolean): Promise<AppReply> {
  const [pref, model] = await Promise.all([getPreferredEngineId(db).catch(() => null), loadInstalledModel(db).catch(() => null)]);
  const on = pref === 'on-device-llm' && await onDeviceLlmEngine.isReady().catch(() => false);
  const text = on
    ? (bn ? `✓ AI চালু — ${model?.name ?? 'মডেল'} দিয়ে উত্তর সুন্দর করে লিখছে ও না-বোঝা বাক্য বুঝতে চেষ্টা করছে।` : `✓ The AI is on — ${model?.name ?? 'the model'} is wording answers and reading sentences the rules cannot.`)
    : !model ? (bn ? 'AI মডেল যোগ করা নেই। সাধারণ মোডে সব কাজ চলছে; AI যোগ করতে AI মডেল পাতা খুলুন।' : 'No AI model is added. Everything works in basic mode; open the AI model screen to add one.')
      : lastLoadDidNotFinish() ? (bn ? '⚠ শেষবার মডেল চালু হতে গিয়ে অ্যাপ বন্ধ হয়ে গিয়েছিল, তাই AI বন্ধ রাখা হয়েছে। AI মডেল পাতা থেকে আবার পরীক্ষা করুন।' : '⚠ The app closed while loading the model last time, so the AI is kept off. Re-test it on the AI model screen.')
        : !model.verifiedAt || !model.connectionTest?.ok ? (bn ? 'মডেল আছে, কিন্তু পরীক্ষা ও সংযোগ-পরীক্ষা শেষ হয়নি। AI মডেল পাতায় ধাপগুলো শেষ করুন।' : 'A model is added but not yet tested and connected. Finish the steps on the AI model screen.')
          : (bn ? 'মডেল প্রস্তুত, কিন্তু আপন-এ চালু করা নেই। AI মডেল পাতায় "আপন-এ AI চালু করুন" চাপুন।' : 'The model is ready but not switched on for Apon. Tap "Use in Apon" on the AI model screen.');
  // The last trouble in the past day, and what to do about it (llm-health.ts).
  const issue = lastLlmIssue();
  const recent = issue && Date.now() - Date.parse(issue.at) < 86_400_000 ? llmIssueCopy(issue.kind, bn) : null;
  const trouble = recent
    ? `\n\n${bn ? 'শেষ সমস্যা' : 'Last problem'}: ${recent.title}\n${recent.body}\n${bn ? 'কী করবেন' : 'What to do'}:\n${recent.steps.map((s) => `• ${s}`).join('\n')}`
    : '';
  return { text: text + trouble, open: 'ai-model', trace: ['app-query:ai-status', `on:${on}`, ...(recent ? [`issue:${issue!.kind}`] : [])] };
}

async function backupStatus(db: SQLiteDatabase, bn: boolean): Promise<AppReply> {
  const [auto, manual, folder] = await Promise.all([
    readPreference(db, LAST_AUTO_BACKUP_KEY), readPreference(db, 'lastBackupAt'), readPreference(db, 'autoBackupFolderUri'),
  ]);
  const latest = [auto, manual].filter((v): v is string => !!v && Number.isFinite(Date.parse(v))).sort().pop();
  const days = latest ? Math.floor((Date.now() - Date.parse(latest)) / 86_400_000) : null;
  const text = !latest
    ? (bn ? '⚠ এখনো কোনো ব্যাকআপ নেওয়া হয়নি। "এখনই ব্যাকআপ নাও" বললে নিয়ে দেব।' : '⚠ No backup has been taken yet. Say "back up now" and I will take one.')
    : (bn ? `শেষ ব্যাকআপ: ${formatBangladeshDateTime(latest, 'bn')} (${days === 0 ? 'আজ' : `${num(days!, bn)} দিন আগে`})।` : `Last backup: ${formatBangladeshDateTime(latest, 'en')} (${days === 0 ? 'today' : `${days} day(s) ago`}).`)
      + (folder ? (bn ? '\nApon ফোল্ডারেও কপি রাখা হচ্ছে।' : '\nA copy also goes to the Apon folder.') : (bn ? '\nশুধু ফোনের ভেতরে রাখা হচ্ছে — ফোল্ডার বেছে নিলে ফোন হারালেও কপি থাকবে।' : '\nKept inside the phone only — choose a folder so a copy survives losing the phone.'))
      + (days !== null && days > 7 ? (bn ? '\n⚠ এক সপ্তাহের বেশি পুরোনো — নতুন করে নেওয়া ভালো।' : '\n⚠ More than a week old — worth taking a fresh one.') : '');
  return { text, open: 'backup', trace: ['app-query:backup-status', `days:${days ?? 'never'}`] };
}

// The time, the date and the weekday in the app's time zone (Settings → time zone).
function clock(bn: boolean): AppReply {
  const now = new Date();
  const lang = bn ? 'bn' : 'en';
  const text = bn
    ? `এখন ${formatBangladeshTime(now, lang)} — ${formatBangladeshWeekdayDate(now, lang)}।\n(${timeZoneLabel(lang)} সময় অনুযায়ী)`
    : `It is ${formatBangladeshTime(now, lang)} — ${formatBangladeshWeekdayDate(now, lang)}.\n(${timeZoneLabel(lang)} time)`;
  return { text, trace: ['app-query:clock'] };
}

export async function answerAppQuery(db: SQLiteDatabase, topic: QueryTopic, subject: string | undefined, lang: Lang): Promise<AppReply> {
  const bn = lang === 'bn';
  switch (topic) {
    case 'PLAN_TODAY':
      return subject === 'tomorrow' || subject === 'week' || subject === 'overdue' ? planAhead(db, bn, subject) : planToday(db, bn);
    case 'DEBT_SUMMARY': return debts(db, bn);
    case 'DEBT_PERSON': return debts(db, bn, subject);
    case 'BALANCE': return balance(db, bn);
    case 'MONEY_MONTH': return moneyMonth(db, bn, subject);
    case 'ABOUT_APON': {
      const about = (subject ?? 'identity') as AboutTopic;
      return { text: aboutAponAnswer(about, bn), ...(about === 'manual' ? { open: 'guide' as ScreenId } : {}), trace: ['app-query:about-apon', about] };
    }
    case 'HEALTH_NEXT_DOSE':
    case 'HEALTH_MISSED':
    case 'HEALTH_UPCOMING': return health(db, topic, lang);
    case 'SEARCH_ALL': return searchEverything(db, subject ?? '', lang);
    case 'APP_STATUS': return appStatus(db, bn);
    case 'REMINDER_STATUS': return reminderStatus(bn);
    case 'AI_STATUS': return aiStatus(db, bn);
    case 'BACKUP_STATUS': return backupStatus(db, bn);
    case 'CLOCK': return clock(bn);
    case 'HOW_TO': { const g = guideAnswer((subject ?? 'task') as GuideTopic, bn); return { text: g.text, open: g.screen, trace: ['app-query:how-to', subject ?? ''] }; }
  }
}

// ── commands (each runs only after the person confirmed it) ──────────────────────────

export async function runAppCommand(
  db: SQLiteDatabase, topic: CommandTopic, subject: string | undefined, lang: Lang,
): Promise<AppReply & { done: boolean }> {
  const bn = lang === 'bn';
  switch (topic) {
    case 'BACKUP_NOW': {
      const folder = await readPreference(db, 'autoBackupFolderUri');
      const result = await runAutoBackup(db, folder, { force: true });
      if (!result.ran) return { done: false, text: bn ? 'ব্যাকআপ নেওয়া যায়নি। ব্যাকআপ পাতা থেকে আবার চেষ্টা করুন।' : 'The backup could not be taken. Try again from the Backup screen.', open: 'backup', trace: ['app-command:backup', 'failed'] };
      return {
        done: true,
        text: (bn ? '✓ ব্যাকআপ নেওয়া হয়েছে — ফোনের ভেতরে সেভ হয়েছে' : '✓ Backup taken — saved inside the phone')
          + (folder ? (result.folderWritten ? (bn ? ', Apon ফোল্ডারেও কপি রাখা হয়েছে।' : ', with a copy in the Apon folder.') : (bn ? '; ফোল্ডারে লেখা যায়নি।' : '; could not write to the folder.')) : '.'),
        open: 'backup', trace: ['app-command:backup', `folder:${result.folderWritten}`],
      };
    }
    case 'DOSE_TAKEN': {
      const today = bangladeshDateKey(new Date());
      await ensureDosesForDay(db, today);
      const doses = await listDoses(db, today);
      const dose = pickDose(doses, subject);
      if (!dose) {
        return { done: false, text: explainNoDose(doses, subject, bn), open: 'health', trace: ['app-command:dose', 'none'] };
      }
      await setDoseStatus(db, dose.id, 'TAKEN');
      return {
        done: true,
        text: bn ? `✓ ${dose.medicineName ?? 'ওষুধ'} (${formatBangladeshTime(dose.dueAt, 'bn')}-এর ডোজ) খাওয়া হয়েছে লেখা হলো।` : `✓ Marked ${dose.medicineName ?? 'the dose'} (${formatBangladeshTime(dose.dueAt, 'en')}) as taken.`,
        open: 'health', trace: ['app-command:dose', `dose:${dose.id}`],
      };
    }
    case 'PLAN_INBOX': {
      const plan = await getDailyPlan(db);
      if (!plan.inbox.length) return { done: false, text: bn ? 'ইনবক্স খালি — আজকের প্ল্যানে দেওয়ার মতো কিছু নেই।' : 'The inbox is empty — nothing to plan.', open: 'planning', trace: ['app-command:plan-inbox', 'empty'] };
      const planned = await planInboxTasks(db, plan.inbox.map((t) => t.id));
      return {
        done: true,
        text: (bn ? `✓ ইনবক্সের ${num(planned.length, bn)}টি কাজ আজকের প্ল্যানে রাখা হলো:\n` : `✓ Put ${planned.length} inbox task(s) on today:\n`) + list(planned, (t) => t.title, 6, bn),
        open: 'planning', trace: ['app-command:plan-inbox', `planned:${planned.length}`],
      };
    }
  }
}

/** What "ওষুধ খেয়েছি" will mark, shown on the confirm card before anything is written. */
export async function previewDose(db: SQLiteDatabase, subject: string | undefined, lang: Lang): Promise<string> {
  const bn = lang === 'bn';
  const today = bangladeshDateKey(new Date());
  await ensureDosesForDay(db, today);
  const doses = await listDoses(db, today);
  const dose = pickDose(doses, subject);
  if (!dose) return explainNoDose(doses, subject, bn);
  return bn
    ? `এটা লেখা হবে: ${dose.medicineName ?? 'ওষুধ'} (${formatBangladeshTime(dose.dueAt, 'bn')}-এর ডোজ) — খাওয়া হয়েছে`
    : `Will mark: ${dose.medicineName ?? 'medicine'} (${formatBangladeshTime(dose.dueAt, 'en')} dose) — taken`;
}
