// Everything the Assistant can do, in one place — and the first decision on every sentence:
// which part of the app is this about? Tasks, memories, planning, search, money, debts,
// health, analysis, the app's own state, backup, or simply "take me to that screen".
//
// The rule-based core already reads tasks, memories, money and debts (nlp/intent.ts). This
// file adds the rest of the app, without touching those paths: a sentence is only claimed
// here when it clearly asks about one of the domains below, and a sentence that records
// money ("বাজারে ৫০০ টাকা খরচ") is never claimed at all.
//
// Three kinds of ability, and each kind has one safety rule:
//   query   — reads only; runs as soon as it is asked.
//   command — writes; always shows a confirm card first.
//   open    — opens a screen. Anything that could lose data (restore, delete, reset) or
//             change how the app behaves (settings) is only ever *opened*, never done by
//             the Assistant, so the person makes that change with their own hands.

import type { IconName } from '../ui/AppIcon';
import { aboutAponTopic } from './about-apon';
import { guideTopicFor } from './app-guide';

export type QueryTopic =
  | 'PLAN_TODAY'
  | 'DEBT_SUMMARY'
  | 'DEBT_PERSON'
  | 'BALANCE'
  | 'MONEY_MONTH'
  | 'ABOUT_APON'
  | 'HEALTH_NEXT_DOSE'
  | 'HEALTH_MISSED'
  | 'HEALTH_UPCOMING'
  | 'SEARCH_ALL'
  | 'APP_STATUS'
  | 'REMINDER_STATUS'
  | 'AI_STATUS'
  | 'BACKUP_STATUS'
  | 'CLOCK'
  | 'HOW_TO';

export type CommandTopic = 'BACKUP_NOW' | 'DOSE_TAKEN' | 'PLAN_INBOX';

export type ScreenId =
  | 'home' | 'planning' | 'inbox' | 'calendar' | 'reminders' | 'focus' | 'memory' | 'timeline'
  | 'finance' | 'wallets' | 'debt' | 'health' | 'people' | 'search' | 'settings' | 'backup'
  | 'diagnostics' | 'ai-model' | 'trash' | 'permissions' | 'guide';

/** Why a screen is being opened instead of the Assistant doing the thing itself. */
export type OpenReason = 'asked' | 'setting-change' | 'restore' | 'delete' | 'repay' | 'write';

export type AppIntentSpec =
  | { kind: 'query'; topic: QueryTopic; subject?: string }
  | { kind: 'command'; topic: CommandTopic; subject?: string }
  | { kind: 'open'; screen: ScreenId; reason: OpenReason };

export interface ScreenInfo { route: string; bn: string; en: string; words: RegExp }

// `words` is how people name the screen; a screen is only opened on an explicit
// "খোলো / যাও / open / go to", so "আজকের কাজগুলো দেখাও" stays a question about tasks.
export const SCREENS: Record<ScreenId, ScreenInfo> = {
  home: { route: '/', bn: 'হোম', en: 'Home', words: /হোম|home/iu },
  planning: { route: '/planning', bn: 'পরিকল্পনা', en: 'Planning', words: /পরিকল্পনা|প্ল্যানিং|প্ল্যান|planning|plan/iu },
  inbox: { route: '/inbox', bn: 'ইনবক্স', en: 'Inbox', words: /ইনবক্স|inbox/iu },
  calendar: { route: '/calendar', bn: 'ক্যালেন্ডার', en: 'Calendar', words: /ক্যালেন্ডার|ক্যালেন্ডা|calendar/iu },
  reminders: { route: '/reminders', bn: 'রিমাইন্ডার', en: 'Reminders', words: /রিমাইন্ডার|reminders?/iu },
  focus: { route: '/focus', bn: 'ফোকাস', en: 'Focus', words: /ফোকাস|focus/iu },
  memory: { route: '/memory', bn: 'মেমোরি', en: 'Memories', words: /মেমোরি|মেমরি|স্মৃতি|নোট|memor(?:y|ies)|notes?/iu },
  timeline: { route: '/timeline', bn: 'টাইমলাইন', en: 'Timeline', words: /টাইমলাইন|timeline/iu },
  finance: { route: '/finance', bn: 'আয়-ব্যয়', en: 'Finance', words: /ফিন্যান্স|ফাইন্যান্স|আয়-?ব্যয়|হিসাব(?:ের)? পাতা|খরচের পাতা|finance|money/iu },
  wallets: { route: '/finance/wallets', bn: 'ওয়ালেট', en: 'Wallets', words: /ওয়ালেট|মানিব্যাগ|wallets?/iu },
  debt: { route: '/debt', bn: 'দেনা-পাওনা', en: 'Debts', words: /দেনা|পাওনা|ঋণ|ধারের|debts?|loans?/iu },
  health: { route: '/health', bn: 'স্বাস্থ্য', en: 'Health', words: /স্বাস্থ্য|ওষুধের পাতা|health|medicines?/iu },
  people: { route: '/people', bn: 'মানুষজন', en: 'People', words: /মানুষজন|লোকজন|পরিচিত|কন্টাক্ট|people|contacts?/iu },
  search: { route: '/search', bn: 'খোঁজা', en: 'Search', words: /খোঁজার পাতা|সার্চ|search/iu },
  settings: { route: '/settings', bn: 'সেটিংস', en: 'Settings', words: /সেটিংস|সেটিং|settings?/iu },
  backup: { route: '/backup', bn: 'ব্যাকআপ', en: 'Backup', words: /ব্যাকআপ|backup/iu },
  diagnostics: { route: '/diagnostics', bn: 'অ্যাপ ঠিক আছে কি না', en: 'Is the app all right', words: /ডায়াগনস্টিক\S*|ডায়াগনোস্টিক\S*|diagnostics?/iu },
  'ai-model': { route: '/ai-model', bn: 'AI মডেল', en: 'AI model', words: /(?:এআই|ai)\s*(?:মডেল|model|সেটিং\S*)/iu },
  trash: { route: '/trash', bn: 'মুছে ফেলা জিনিস', en: 'Deleted items', words: /ট্র্যাশ|ট্রাশ|রিসাইকেল|trash|recycle/iu },
  permissions: { route: '/permissions', bn: 'অনুমতি', en: 'Permissions', words: /অনুমতি|পারমিশন|permissions?/iu },
  guide: { route: '/guide', bn: 'গাইড', en: 'Guide', words: /গাইড|নির্দেশিকা|guide/iu },
};

// Order matters where names overlap: "AI মডেল" before anything, "ওয়ালেট" before "আয়-ব্যয়".
const SCREEN_ORDER: ScreenId[] = [
  'ai-model', 'diagnostics', 'permissions', 'wallets', 'reminders', 'inbox', 'calendar', 'focus', 'timeline',
  'trash', 'backup', 'settings', 'search', 'people', 'health', 'debt', 'finance', 'memory', 'planning', 'guide', 'home',
];

export function screenMentioned(text: string): ScreenId | null {
  return SCREEN_ORDER.find((id) => SCREENS[id].words.test(text)) ?? null;
}

export interface Capability {
  domain: 'task' | 'memory' | 'planning' | 'search' | 'money' | 'debt' | 'health' | 'analysis' | 'app' | 'backup' | 'navigate';
  kind: 'query' | 'command' | 'open';
  bn: string;
  en: string;
  example: { bn: string; en: string };
}

/**
 * The abilities added on top of the core, each with a sentence that is known to work —
 * `tests/assistant-app-domains.test.ts` runs every example below through the planner.
 */
export const CAPABILITIES: readonly Capability[] = [
  { domain: 'planning', kind: 'query', bn: 'আজকের পরিকল্পনা', en: 'Today’s plan', example: { bn: 'আজ কী কী করতে হবে?', en: 'What should I do today?' } },
  { domain: 'debt', kind: 'query', bn: 'দেনা-পাওনার হিসাব', en: 'Debts and what you are owed', example: { bn: 'আমার মোট দেনা কত?', en: 'How much do I owe?' } },
  { domain: 'debt', kind: 'query', bn: 'একজনের সাথে হিসাব', en: 'One person’s balance', example: { bn: 'রহিমের কাছে কত পাব?', en: 'How much does Rahim owe me?' } },
  { domain: 'money', kind: 'query', bn: 'হাতে কত টাকা', en: 'Money on hand', example: { bn: 'হাতে কত টাকা আছে?', en: 'How much money do I have?' } },
  { domain: 'app', kind: 'query', bn: 'আপন সম্পর্কে ও ব্যবহার নির্দেশিকা', en: 'About Apon and the user guide', example: { bn: 'ব্যবহার নির্দেশিকা দাও', en: 'user guide' } },
  { domain: 'money', kind: 'query', bn: 'মাসের আয়-খরচ', en: 'This month’s income and spending', example: { bn: 'এই মাসে কত খরচ হয়েছে?', en: 'How much did I spend this month?' } },
  { domain: 'health', kind: 'query', bn: 'পরের ওষুধ', en: 'Next dose', example: { bn: 'পরের ওষুধ কখন?', en: 'When is my next dose?' } },
  { domain: 'health', kind: 'query', bn: 'বাদ পড়া ওষুধ', en: 'Missed doses', example: { bn: 'কোন ওষুধ বাদ গেছে?', en: 'Did I miss any dose?' } },
  { domain: 'health', kind: 'query', bn: 'সামনের ডাক্তার/টেস্ট', en: 'Upcoming doctor / tests', example: { bn: 'ডাক্তার দেখানো কবে?', en: 'When is my next doctor visit?' } },
  { domain: 'search', kind: 'query', bn: 'সব জায়গায় খোঁজা', en: 'Search everything', example: { bn: 'সব জায়গায় পাসপোর্ট খোঁজো', en: 'Search everywhere for passport' } },
  { domain: 'app', kind: 'query', bn: 'অ্যাপ ঠিক আছে কি না', en: 'Is the app healthy', example: { bn: 'অ্যাপ ঠিক আছে তো?', en: 'Is the app working?' } },
  { domain: 'app', kind: 'query', bn: 'রিমাইন্ডার চালু কি না', en: 'Are reminders on', example: { bn: 'রিমাইন্ডার কাজ করছে?', en: 'Are my reminders working?' } },
  { domain: 'app', kind: 'query', bn: 'AI চালু কি না', en: 'Is the AI on', example: { bn: 'AI চালু আছে?', en: 'Is the AI on?' } },
  { domain: 'backup', kind: 'query', bn: 'শেষ ব্যাকআপ', en: 'Last backup', example: { bn: 'শেষ ব্যাকআপ কবে?', en: 'When was the last backup?' } },
  { domain: 'backup', kind: 'command', bn: 'এখনই ব্যাকআপ', en: 'Back up now', example: { bn: 'এখনই ব্যাকআপ নাও', en: 'Back up now' } },
  { domain: 'health', kind: 'command', bn: 'ওষুধ খাওয়া হয়েছে', en: 'Mark a dose taken', example: { bn: 'সকালের ওষুধ খেয়েছি', en: 'I took my medicine' } },
  { domain: 'planning', kind: 'command', bn: 'ইনবক্স আজকের প্ল্যানে', en: 'Plan the inbox for today', example: { bn: 'ইনবক্সের কাজগুলো আজকের প্ল্যানে দাও', en: 'Plan my inbox for today' } },
  { domain: 'navigate', kind: 'open', bn: 'যেকোনো পাতা খোলা', en: 'Open any screen', example: { bn: 'সেটিংস খোলো', en: 'Open settings' } },
];

// ── detection ────────────────────────────────────────────────────────────────────────

const REPAYMENT = /(?:ফেরত|শোধ)\s*(?:দিলাম|দিয়েছি|দিছি|পেলাম|পেয়েছি|পাইছি|করলাম|করেছি|দিল|দিয়েছে)(?![\p{L}\p{M}])|\b(?:paid (?:\w+ )?back|repaid|got (?:my money )?back)\b/iu;
const WANTS_TO_WRITE = /^(?:নতুন\s*)?(?:একটা|একটি)?\s*(?:নতুন\s*)?(?:মেমোরি|মেমরি|নোট|কাজ|টাস্ক|খরচ|আয়|হিসাব)\s*(?:লিখতে|যোগ\s*করতে|যুক্ত\s*করতে|রাখতে)\s*(?:চাই|চাচ্ছি)[\s।.!]*$/u;
const OPEN_VERB = /(?:খোলো|খোল(?![\p{L}\p{M}])|খুলুন|খুলে\s*(?:দাও|দিন|দেখাও)|(?:এ|ে|তে|য়)\s*(?:যাও|যান|চলো|নিয়ে\s*চলো)|পাতা(?:টা)?\s*দেখাও|\bopen\b|\bgo to\b|\btake me to\b|\bshow (?:me )?the \w+ (?:page|screen)\b)/iu;
const SETTING_WORD = /(?:ডার্ক|লাইট|থিম|ভাষা|ফন্ট|অ্যাপ\s*লক|এপ\s*লক|লক\s*স্ক্রিন|শব্দ|সাউন্ড|ভাইব্রেশন|dark mode|light mode|theme|language|font|app lock|sound|vibration)/iu;
const CHANGE_VERB = /(?:চালু|বন্ধ|বদলা\S*|পরিবর্তন|পাল্টা\S*|সেট\s*করো|করে\s*দাও|turn (?:on|off)|enable|disable|change|switch)/iu;
const RESTORE_WORD = /(?:রিস্টোর|রিস্টোর|ব্যাকআপ\s*থেকে\s*(?:ফেরত|ফিরিয়ে)|restore)/iu;
const DELETE_WORD = /(?:মুছে\s*(?:দাও|ফেলো|দিন)|ডিলিট|রিসেট|সব\s*মুছ|\bdelete\b|\breset\b|\bwipe\b|\berase\b)/iu;

// A sum with a ledger word is money being recorded — the core's, never this file's.
const RECORDS_MONEY = /[০-৯\d][০-৯\d,.]*\s*(?:টাকা|৳|tk\b|taka\b)/u;
const ASKS_HOW_MUCH = /(?<![\p{L}\p{M}])(?:কত|কতো)(?![\p{L}\p{M}])|how much/iu;

interface QueryRule { topic: QueryTopic | CommandTopic; kind: 'query' | 'command'; test: RegExp; subject?: (text: string) => string | undefined }

const MEDICINE_WORD = /(?:ওষুধ|ঔষধ|ডোজ|ট্যাবলেট|ক্যাপসুল|সিরাপ|ইনসুলিন|ইনহেলার|medicine|medication|dose|pill|tablet|insulin)/iu;

function personBefore(text: string): string | undefined {
  // "করিম ভাইকে", "রহিমা আপার কাছে" — the case ending sits on the honorific, so the name is
  // the word before it (it once looked for someone called "ভাই" — rc.13 review).
  const honored = text.match(/([\p{L}\p{M}]{2,})\s+(?:ভাইয়া|ভাই|আপা|সাহেব|দাদা|দিদি|খালা|চাচা|মামা|কাকা|আন্টি|আঙ্কেল)(?:য়ের|য়ের|ের|এর|র|কে)\s+(?:কাছে|কাছ\s*থেকে|থেকে|কত|কতো)/u);
  if (honored?.[1] && !/^(?:আমা|তোমা|আপনা|তা|ও|কা|সবা|কো|কার)$/u.test(honored[1])) return honored[1];
  // "রহিমের কাছে", "রহিমের থেকে", "রহিমকে" — the name the case ending is attached to.
  const bn = text.match(/([\p{L}\p{M}]{2,}?)(?:ের|এর|র)\s+(?:কাছে|কাছ\s*থেকে|থেকে)/u)
    ?? text.match(/([\p{L}\p{M}]{2,}?)কে\s+(?:কত|কতো)/u);
  const name = bn?.[1];
  if (name && !/^(?:আমা|তোমা|আপনা|তা|ও|কা|সবা|কো|কার|কা)$/u.test(name)) return name;
  const en = text.match(/\bdoes\s+([a-z][\w-]*)\s+owe\b|\bdo i owe\s+([a-z][\w-]*)|\b([a-z][\w-]*)\s+owes me\b/iu);
  return en?.[1] ?? en?.[2] ?? en?.[3] ?? undefined;
}

function searchSubject(text: string): string | undefined {
  const bn = text.match(/(?:সব\s*(?:জায়গায়|জায়গায়|খানে|কিছুতে)|সবখানে|সবকিছুতে)\s+(.+?)\s+(?:খোঁজ\S*|খুঁজ\S*|খোজ\S*|খুজ\S*)/u)
    ?? text.match(/(.+?)\s+(?:সব\s*(?:জায়গায়|জায়গায়|খানে)|সবখানে)\s+(?:খোঁজ\S*|খুঁজ\S*|খোজ\S*|খুজ\S*)/u);
  const en = text.match(/\bsearch (?:everywhere|everything|all) for\s+(.+)$|\bfind\s+(.+?)\s+everywhere\b/iu);
  const raw = bn?.[1] ?? en?.[1] ?? en?.[2];
  return raw?.replace(/["“”'`]/gu, '').replace(/(?:টা|টি|গুলো)$/u, '').trim() || undefined;
}

function doseSubject(text: string): string | undefined {
  const m = text.match(/([\p{L}\p{M}]+)\s+(?:ওষুধ|ঔষধ|ট্যাবলেট|ক্যাপসুল|সিরাপ|ডোজ)?\s*(?:খেয়েছি|খেয়ে\s*ফেলেছি|খেলাম|খাইছি|খাইলাম|খাইসি|নিয়েছি)/u);
  const word = m?.[1];
  if (!word || MEDICINE_WORD.test(word) || /^(?:আমি|এইমাত্র|এখন|মাত্র|আজ|আজকের)$/u.test(word)) return undefined;
  return word.replace(/(?:ের|এর|র)$/u, '') || undefined;
}

const RULES: QueryRule[] = [
  // Commands first: "ব্যাকআপ নাও" must not read as a question about backups.
  { topic: 'BACKUP_NOW', kind: 'command', test: /(?:ব্যাকআপ\s*(?:নাও|নিন|নিয়ে\s*রাখো|নিয়ে\s*নাও|করো|করে\s*রাখো|দাও|রাখো)|(?:এখনই|এখন)\s*ব্যাকআপ(?!\s*(?:কবে|আছে))|\bback ?up (?:now|my data|everything)\b|\b(?:take|make|do) a backup\b)/iu },
  { topic: 'DOSE_TAKEN', kind: 'command', test: /(?:খেয়েছি|খেয়ে\s*ফেলেছি|খেলাম|খাইছি|খাইলাম|খাইসি|নিয়েছি)(?!.*(?:কি|কী|\?))|\b(?:i )?(?:took|have taken) my\b|\bi took (?:the )?\w+/iu, subject: doseSubject },
  { topic: 'PLAN_INBOX', kind: 'command', test: /ইনবক্স\S*\s*(?:গুছিয়ে|গুছাও|গুছিয়ে\s*(?:দাও|দিন|দিও|ফেলো))/u },
  { topic: 'PLAN_INBOX', kind: 'command', test: /(?:ইনবক্স\S*.*(?:আজ|প্ল্যান|পরিকল্পনা)|\bplan (?:my )?inbox\b|\binbox\b.*\btoday\b)/iu },

  // "ওষুধ কিভাবে যোগ করব?" — about the app itself, answered from app-guide.ts.
  { topic: 'HOW_TO', kind: 'query', test: /./u, subject: (t) => guideTopicFor(t) ?? undefined },
  // "এখন কয়টা বাজে", "আজ কত তারিখ", "আজ কী বার" — answered from the phone's clock in the
  // app's own time zone, never guessed by a model.
  { topic: 'CLOCK', kind: 'query', test: /(?:(?:এখন\s*)?(?:কয়টা|কয়টা|কটা|ক'টা)\s*বাজে|(?:এখন\s*)?সময়\s*(?:কত|কতো)|(?:আজ|আজকে)\s*(?:কত|কতো)\s*তারিখ|(?:আজ|আজকে)\s*(?:কী|কি)\s*বার|\bwhat time is it\b|\bwhat(?:'s| is) the time\b|\bwhat(?:'s| is) (?:the )?date\b|\bwhat day is (?:it|today)\b|\btoday'?s date\b)/iu },
  { topic: 'BACKUP_STATUS', kind: 'query', test: /(?:(?:শেষ|সর্বশেষ|লাস্ট|আগের)\s*ব্যাকআপ|ব্যাকআপ\s*(?:কবে|কখন|আছে\s*(?:কি|তো)|নেওয়া\s*আছে|হয়েছে\s*কি)|\blast backup\b|\bwhen\b.*\bback(?:ed)? ?up\b|\bis (?:my data|everything) backed up\b)/iu },
  { topic: 'REMINDER_STATUS', kind: 'query', test: /(?:রিমাইন্ডার|নোটিফিকেশন|অ্যালার্ম|এলার্ম)\S*\s*(?:ঠিকমতো|ঠিক\s*সময়ে|ঠিকঠাক|সময়মতো)\s*(?:আসবে|বাজবে|আসছে|বাজছে)/u },
  { topic: 'REMINDER_STATUS', kind: 'query', test: /(?:(?:রিমাইন্ডার|নোটিফিকেশন|নোটিফিকেশান|এলার্ম|অ্যালার্ম)\S*\s*(?:কাজ\s*করছে|চালু\s*আছে|ঠিক\s*আছে|আসবে|আসছে\s*না|আসে\s*না|বন্ধ)|\b(?:reminders?|notifications?|alarms?) (?:working|on|off|not coming)\b|\bare (?:my )?(?:reminders|notifications) (?:working|on)\b)/iu },
  { topic: 'AI_STATUS', kind: 'query', test: /(?:(?:এআই|ai)\s*(?:মডেল)?\s*(?:চালু\s*(?:আছে|কি)|কাজ\s*করছে|ঠিক\s*আছে|আছে\s*কি|প্রস্তুত|ধীর|স্লো|আস্তে|বন্ধ\s*হয়ে|কাজ\s*করছে\s*না|চলছে\s*না|আটকে)|\bis (?:the )?ai (?:on|working|ready)\b|\bwhy is (?:the )?ai (?:slow|not working)\b)/iu },
  { topic: 'APP_STATUS', kind: 'query', test: /(?:(?:অ্যাপ|এপ|অ্যাপটা|এপটা|app)\s*(?:ঠিক|ঠিকঠাক|ভালো)\s*(?:আছে|চলছে)|সব\s*ঠিক\s*আছে\s*(?:তো|কি)|কোনো?\s*সমস্যা\s*আছে\s*(?:কি|তো)?|(?:ডায়াগনস্টিক|চেক\s*আপ|চেকআপ)\s*(?:চালাও|করো)|\bis (?:the )?app (?:ok|okay|working|healthy)\b|\b(?:run a )?health ?check\b)/iu },

  { topic: 'HEALTH_NEXT_DOSE', kind: 'query', test: /(?:(?:পরের|পরবর্তী|এরপরের|এর\s*পরের)\s*(?:ওষুধ|ঔষধ|ডোজ)|(?:ওষুধ|ঔষধ|ডোজ)\S*\s*(?:কখন|কটায়|ক'টায়)\s*(?:খা|নি)|\bnext (?:dose|medicine|pill)\b|\bwhen (?:is|do i take) my (?:next )?(?:medicine|dose|pill)\b)/iu },
  { topic: 'HEALTH_MISSED', kind: 'query', test: /(?:(?:ওষুধ|ঔষধ|ডোজ)\S*.*(?:বাদ\s*(?:গেছে|পড়েছে)|মিস|খাওয়া\s*হয়নি|খাইনি)|\bmissed (?:a |any )?(?:dose|medicine|pill)s?\b|\bdid i miss\b)/iu },
  { topic: 'HEALTH_UPCOMING', kind: 'query', test: /(?:ডাক্তার\S*.*(?:কবে|কখন)|(?:টেস্ট|পরীক্ষা)\S*.*(?:কবে|কখন)|(?:ওষুধ|ঔষধ)\S*.*(?:ফুরাবে|ফুরিয়ে|শেষ\s*হবে)|ফলো\s*-?আপ|\bnext (?:doctor|appointment|test|check-?up)\b|\brefill\b|\bwhen (?:is|do i see) (?:my )?(?:next )?doctor\b)/iu },

  { topic: 'DEBT_PERSON', kind: 'query', test: /[\p{L}\p{M}]{2,}\s+(?:আমার\s+)?কাছে\s+(?:কত|কতো)\s*(?:টাকা\s*)?(?:পাবে|পায়|পাইবে)/u, subject: (t) => t.match(/([\p{L}\p{M}]{2,})\s+(?:আমার\s+)?কাছে\s+(?:কত|কতো)/u)?.[1] },
  { topic: 'DEBT_PERSON', kind: 'query', test: /(?:[\p{L}\p{M}]{2,}(?:ের|এর|র)\s+(?:কাছে|কাছ\s*থেকে|থেকে)\s+.*(?:কত|কতো)|[\p{L}\p{M}]{2,}কে\s+(?:কত|কতো)\s+(?:দিতে|ফেরত)|\bhow much does \w+ owe\b|\bhow much do i owe [a-z]\w*|\b\w+ owes me\b)/iu, subject: personBefore },
  // "কোন উৎস থেকে কত খরচ?", "ঋণের টাকা থেকে কত খরচ হলো?", "ঋণ দিয়ে ঋণ শোধ কত?" — whose
  // money paid for things. Answered from the same rows as the money page's source card.
  { topic: 'MONEY_MONTH', kind: 'query', test: /(?:উৎস|কোন\s*টাকা\s*(?:থেকে|দিয়ে)\s*(?:কত\s*)?(?:খরচ|ব্যয়)|(?:ঋণ|ধার)(?:ের)?\s*(?:টাকা(?:য়|য়)?\s*)?(?:থেকে|করে|দিয়ে)\s*(?:কত\s*)?(?:টাকা\s*)?(?:খরচ|ব্যয়)|(?:আয়|বেতন|উপহার|সঞ্চয়|জমানো)\S*\s*(?:টাকা\s*)?থেকে\s*(?:কত\s*)?(?:টাকা\s*)?(?:খরচ|ব্যয়)|(?:ঋণ|ধার)\s*(?:দিয়ে|করে)\s*(?:ঋণ|ধার)\s*(?:শোধ|পরিশোধ)|\bby source\b|\bspent from (?:a )?(?:loan|income|gift|savings)\b|\bwhere did (?:my|the) money come from\b)/iu, subject: (t) => `${/(?:গত|আগের)\s*মাস|\blast month\b/iu.test(t) ? 'last' : 'this'}|উৎস` },
  { topic: 'DEBT_SUMMARY', kind: 'query', test: /(?:দেনা\s*-?\s*পাওনা|ধার\s*-?\s*দেনা)\S*\s*(?:র\s*)?(?:হিসাব|হিসেব|সারাংশ|দেখাও|দাও|বলো)/u },
  { topic: 'DEBT_SUMMARY', kind: 'query', test: /(?:(?:দেনা|ঋণ|ধার|পাওনা)\S*\s*(?:মোট\s*)?(?:কত|কতো|কার\s*কাছে)|(?:মোট|সব\s*মিলিয়ে)\s*(?:দেনা|ঋণ|ধার|পাওনা)|(?:কত|কতো)\s*(?:টাকা\s*)?(?:পাব|পাবো|পাওনা|দেনা)|কার\s*কাছে\s*(?:কত|কতো)|\bhow much do i owe\b|\bhow much (?:am i|i am) owed\b|\bwho owes me\b|\bmy (?:debts|loans)\b)/iu },
  { topic: 'MONEY_MONTH', kind: 'query', test: /(?:(?:এই|এ|চলতি|গত|আগের)\s*মাসে?\S*[^?]*?(?:খরচ|ব্যয়|আয়|কামাই|রোজগার|ইনকাম)|(?:খরচ|ব্যয়|আয়)\S*\s*(?:কত|কতো)\s*(?:হয়েছে|হলো|হল|হইছে|করেছি|করলাম)|(?:কত|কতো)\s*(?:টাকা\s*)?(?:খরচ|আয়)\s*(?:হয়েছে|হলো|হল|করেছি|করলাম)|কোন\s*খাতে|\bhow much did i (?:spend|earn)\b|\b(?:spent|earned) this month\b)/iu, subject: monthSubject },
  { topic: 'BALANCE', kind: 'query', test: /(?:মোট|সব\s*মিলিয়ে|সবমিলিয়ে)\s*(?:কত|কতো)\s*টাকা\s*(?:আছে|আছে\?)|আমার\s*(?:কাছে\s*)?(?:মোট\s*)?কত\s*টাকা\s*আছে/u },
  { topic: 'BALANCE', kind: 'query', test: /(?:(?:হাতে|ওয়ালেটে|মানিব্যাগে|ব্যাংকে|বিকাশে|নগদে|একাউন্টে|অ্যাকাউন্টে|পকেটে)\s*(?:এখন\s*)?(?:কত|কতো)|ব্যালেন্স|\bbalance\b|\bhow much (?:money|cash) (?:do i have|is left)\b|\bmoney on hand\b)/iu },

  // "কালকে কী কাজ আছে", "সময় পেরোনো কাজ কোনগুলো", "এই সপ্তাহের কাজ দেখাও" (rc.13 #9).
  { topic: 'PLAN_TODAY', kind: 'query', test: /(?:(?:আগামীকাল|কালকে|কালকের|কাল)\s*(?:আমার\s*)?(?:কী|কি)\s*(?:কী\s*|কি\s*)?(?:কাজ|করব|করবো|করতে\s*হবে)|(?:আগামীকাল|কালকে|কালকের|কাল)(?:ের)?\s*(?:আমার\s*)?(?:কোনো\s*|কোন\s*)?কাজ\S*\s*(?:কী|কি|আছে|নাকি|দেখাও|কোনগুলো)|(?:আগামীকালের|কালকের)\s*(?:কাজ|পরিকল্পনা|প্ল্যান)|\btomorrow'?s? (?:tasks|plan)\b|\bwhat (?:do i have|is on) tomorrow\b)/iu, subject: () => 'tomorrow' },
  { topic: 'PLAN_TODAY', kind: 'query', test: /(?:(?:সময়|সময়)\s*(?:পেরোনো|পেরিয়ে\s*যাওয়া|পেরিয়ে\s*যাওয়া|পার\s*হওয়া|পার\s*হওয়া)|বাকি\s*থাকা|না\s*করা)\s*কাজ|\boverdue tasks\b/iu, subject: () => 'overdue' },
  { topic: 'PLAN_TODAY', kind: 'query', test: /(?:এই|এ|চলতি)\s*সপ্তাহে(?:র)?\s*(?:কী\s*কী\s*|কি\s*কি\s*)?(?:কাজ|পরিকল্পনা|প্ল্যান)|সাত\s*দিনের\s*কাজ|\bthis week'?s? (?:tasks|plan)\b|\bwhat do i have this week\b/iu, subject: () => 'week' },
  { topic: 'PLAN_TODAY', kind: 'query', test: /(?:(?:আজ|আজকে|আজকের)\s*(?:আমার\s*)?(?:কী|কি)\s*(?:কী\s*|কি\s*)?(?:করব|করবো|করতে\s*হবে|কাজ\s*আছে)|(?:আজকের|দিনের|আমার)\s*(?:পরিকল্পনা|প্ল্যান)(?!\S*\s*(?:খোল|খুল))|(?:বাকি\s*পড়া|মেয়াদ\s*(?:পেরোনো|পেরিয়ে\s*যাওয়া)|পিছিয়ে\s*পড়া)\s*কাজ|\bwhat(?:'s| is) (?:my )?plan\b|\bwhat should i do today\b|\bplan (?:for )?today\b|\bwhat do i have today\b|\boverdue\b)/iu },
  { topic: 'SEARCH_ALL', kind: 'query', test: /(?:(?:সব\s*(?:জায়গায়|জায়গায়|খানে|কিছুতে)|সবখানে|সবকিছুতে).*(?:খোঁজ|খুঁজ|খোজ|খুজ)|\bsearch (?:everywhere|everything|all)\b|\bfind .+ everywhere\b)/iu, subject: searchSubject },
];

/**
 * The domain claim for one sentence, or null when the sentence belongs to the core
 * (tasks, memories, money entries, debts being created) or to nobody.
 */
/** "last" for গত/আগের মাস, then the spending named, if any: "last|বাজার". */
function monthSubject(t: string): string {
  const last = /(?:গত|আগের)\s*মাস|\blast month\b/iu.test(t) ? 'last' : 'this';
  const medical = /(?:চিকিৎসা|ওষুধ|ঔষধ|ডাক্তার|হাসপাতাল|স্বাস্থ্য|medical|medicine|doctor|health)/iu.test(t);
  const named = t.match(/([\p{L}\p{M}]{2,}?)(?:ে|য়|য়|তে)\s+(?:কত|কতো)\s*(?:টাকা\s*)?খরচ/u)?.[1];
  const what = medical ? 'চিকিৎসা' : named && !/^(?:মাস|এই|গত|আজ|আমার)/u.test(named) ? named : '';
  return what ? `${last}|${what}` : last;
}

export function detectAppIntent(text: string): AppIntentSpec | null {
  const t = text.trim();
  if (!t) return null;
  // "তোমাকে কে বানিয়েছে?", "ব্যবহার নির্দেশিকা দাও" — asked about আপন itself. First,
  // because these used to scatter into small talk, help, a question, or even a new task.
  const about = aboutAponTopic(t);
  if (about) return { kind: 'query', topic: 'ABOUT_APON', subject: about };
  // A repayment settles an existing debt — filed as a new loan or a plain expense it
  // would double the balance. The debt screen records it against that person.
  if (REPAYMENT.test(t) && !ASKS_HOW_MUCH.test(t)) return { kind: 'open', screen: 'debt', reason: 'repay' };
  if (RECORDS_MONEY.test(t) && !ASKS_HOW_MUCH.test(t)) return null;
  // "নতুন একটা মেমোরি লিখতে চাই" — wants to write one, has not said what yet.
  const wantsToWrite = t.match(WANTS_TO_WRITE);
  if (wantsToWrite) {
    const screen = /মেমোরি|মেমরি|নোট/u.test(wantsToWrite[0]) ? 'memory' : /খরচ|আয়|হিসাব/u.test(wantsToWrite[0]) ? 'finance' : 'planning';
    return { kind: 'open', screen, reason: 'write' };
  }

  // "অ্যাপ লক কিভাবে চালু করব?" asks how, so it gets the steps (and the screen) rather
  // than only being sent to Settings.
  const guide = guideTopicFor(t);
  if (guide) return { kind: 'query', topic: 'HOW_TO', subject: guide };

  // Changes the Assistant will not make itself — it opens the place where they are made.
  if (RESTORE_WORD.test(t)) return { kind: 'open', screen: 'backup', reason: 'restore' };
  if (SETTING_WORD.test(t) && CHANGE_VERB.test(t)) return { kind: 'open', screen: 'settings', reason: 'setting-change' };
  if (DELETE_WORD.test(t) && /(?:সব|সমস্ত|পুরো|all|everything|data|ডেটা|ডাটা)/iu.test(t)) {
    return { kind: 'open', screen: 'trash', reason: 'delete' };
  }

  if (OPEN_VERB.test(t)) {
    const screen = screenMentioned(t);
    if (screen) return { kind: 'open', screen, reason: 'asked' };
  }

  for (const rule of RULES) {
    if (!rule.test.test(t)) continue;
    if (rule.topic === 'DOSE_TAKEN' && !MEDICINE_WORD.test(t) && !doseSubject(t)) continue;
    if (rule.topic === 'DOSE_TAKEN' && /(?:ভাত|খাবার|নাস্তা|চা|কফি|পানি|দুধ|rice|food|breakfast|lunch|dinner|tea|coffee|water)/iu.test(t) && !MEDICINE_WORD.test(t)) continue;
    const subject = rule.subject?.(t);
    if (rule.topic === 'DEBT_PERSON' && !subject) continue;
    if (rule.topic === 'SEARCH_ALL' && !subject) continue;
    if (rule.topic === 'HOW_TO' && !subject) continue;
    return rule.kind === 'command'
      ? { kind: 'command', topic: rule.topic as CommandTopic, ...(subject ? { subject } : {}) }
      : { kind: 'query', topic: rule.topic as QueryTopic, ...(subject ? { subject } : {}) };
  }
  return null;
}

const TOPIC_LABEL: Record<QueryTopic | CommandTopic, { bn: string; en: string }> = {
  PLAN_TODAY: { bn: 'আজকের পরিকল্পনা', en: 'Today’s plan' },
  DEBT_SUMMARY: { bn: 'দেনা-পাওনার হিসাব', en: 'Debts summary' },
  DEBT_PERSON: { bn: 'একজনের সাথে হিসাব', en: 'Balance with one person' },
  BALANCE: { bn: 'হাতে কত টাকা', en: 'Money on hand' },
  MONEY_MONTH: { bn: 'মাসের আয়-খরচ', en: 'This month’s income and spending' },
  ABOUT_APON: { bn: 'আপন সম্পর্কে ও ব্যবহার নির্দেশিকা', en: 'About Apon and the user guide' },
  HEALTH_NEXT_DOSE: { bn: 'পরের ওষুধ', en: 'Next dose' },
  HEALTH_MISSED: { bn: 'বাদ পড়া ওষুধ', en: 'Missed doses' },
  HEALTH_UPCOMING: { bn: 'সামনের ডাক্তার/টেস্ট/ওষুধ', en: 'Upcoming health items' },
  SEARCH_ALL: { bn: 'সব জায়গায় খোঁজা', en: 'Search everything' },
  APP_STATUS: { bn: 'অ্যাপের অবস্থা যাচাই', en: 'Check the app' },
  REMINDER_STATUS: { bn: 'রিমাইন্ডার যাচাই', en: 'Check reminders' },
  AI_STATUS: { bn: 'AI-এর অবস্থা', en: 'AI status' },
  BACKUP_STATUS: { bn: 'শেষ ব্যাকআপ', en: 'Last backup' },
  CLOCK: { bn: 'এখনকার সময় ও তারিখ', en: 'Time and date now' },
  HOW_TO: { bn: 'অ্যাপ কীভাবে ব্যবহার করবেন', en: 'How to use the app' },
  BACKUP_NOW: { bn: 'এখনই ব্যাকআপ নেওয়া', en: 'Back up now' },
  DOSE_TAKEN: { bn: 'ওষুধ খাওয়া হয়েছে লেখা', en: 'Mark the dose taken' },
  PLAN_INBOX: { bn: 'ইনবক্সের কাজ আজকের প্ল্যানে', en: 'Plan the inbox for today' },
};

/** One line for a confirm card or a plan step. */
export function describeAppAction(
  action: { type: 'APP_QUERY' | 'APP_COMMAND'; topic: QueryTopic | CommandTopic; subject?: string } | { type: 'OPEN_SCREEN'; screen: ScreenId },
  bn: boolean,
): string {
  if (action.type === 'OPEN_SCREEN') return (bn ? 'খুলুন: ' : 'Open: ') + SCREENS[action.screen][bn ? 'bn' : 'en'];
  const label = TOPIC_LABEL[action.topic][bn ? 'bn' : 'en'];
  return action.subject ? `${label}: ${action.subject}` : label;
}

/**
 * What the Assistant can do, grouped the way the app is — shown on its first screen so
 * nobody has to guess what to ask. Every example is planned in
 * tests/assistant-app-domains.test.ts, so a tap always lands on something that works.
 */
export interface AbilityGroup { id: string; icon: IconName; bn: string; en: string; examples: { bn: string[]; en: string[] } }

export const ABILITY_GROUPS: readonly AbilityGroup[] = [
  { id: 'tasks', icon: 'calendar-check-outline', bn: 'কাজ ও পরিকল্পনা', en: 'Tasks & planning',
    examples: { bn: ['আজ কী কী করতে হবে?', 'কাল সকাল ৯টায় মাকে ফোন করতে মনে করিয়ে দিও'], en: ['What should I do today?', 'Remind me to call mom tomorrow at 9am'] } },
  { id: 'money', icon: 'wallet-outline', bn: 'আয়-ব্যয়', en: 'Money',
    examples: { bn: ['বাজারে ৫০০ টাকা খরচ', 'হাতে কত টাকা আছে?'], en: ['Spent 500 taka on groceries', 'How much money do I have?'] } },
  { id: 'debt', icon: 'handshake-outline', bn: 'দেনা-পাওনা', en: 'Debts',
    examples: { bn: ['রহিমকে ২০০০ টাকা ধার দিলাম', 'আমার মোট দেনা কত?'], en: ['Lent 2000 taka to Rahim', 'How much do I owe?'] } },
  { id: 'health', icon: 'pill', bn: 'স্বাস্থ্য', en: 'Health',
    examples: { bn: ['পরের ওষুধ কখন?', 'সকালের ওষুধ খেয়েছি'], en: ['When is my next dose?', 'I took my medicine'] } },
  { id: 'memory', icon: 'bookmark-outline', bn: 'মেমোরি ও খোঁজা', en: 'Memories & search',
    examples: { bn: ['বাসার wifi পাসওয়ার্ড মনে রাখো', 'সব জায়গায় পাসপোর্ট খোঁজো'], en: ['Remember the home wifi password', 'Search everywhere for passport'] } },
  { id: 'analysis', icon: 'chart-bar', bn: 'বিশ্লেষণ', en: 'Analysis',
    examples: { bn: ['গত ৩ মাসের খরচ বিশ্লেষণ করো', 'খরচ কীভাবে কমাতে পারি?'], en: ['Analyse my spending for 3 months', 'How can I spend less?'] } },
  { id: 'app', icon: 'shield-check-outline', bn: 'অ্যাপ ও ব্যাকআপ', en: 'App & backup',
    examples: { bn: ['অ্যাপ ঠিক আছে তো?', 'এখনই ব্যাকআপ নাও'], en: ['Is the app working?', 'Back up now'] } },
];
