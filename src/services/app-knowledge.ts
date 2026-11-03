// What আপন knows about the app it lives in.
//
// The assistant could already answer from what you had *saved* — a note, a task, a loan.
// It could not answer the other half of what people actually ask an assistant: "what can
// you do", "where is the backup", "how do I add a medicine", "does this send my data
// anywhere". Those questions have answers, they were just never written down anywhere the
// assistant could reach.
//
// Two rules shaped this file:
//
// 1. **Modules describe themselves.** Every module already declares a name, a description,
//    a route and its own vocabulary. A hand-written paragraph per module would be a second
//    copy that goes stale the day a module changes, so the module entries here are
//    generated from the registry. Adding a module teaches the assistant about it for free.
//
// 2. **Only what is true.** Every static entry below points at a screen that exists. An
//    assistant that confidently explains a feature the app does not have is worse than one
//    that admits it does not know.

import type { AppLanguage } from '../i18n/date-time';
import { allModules } from '../modules';

export interface KnowledgeEntry {
  id: string;
  /** Words that should reach this entry, in both languages. */
  keywords: string[];
  title: { bn: string; en: string };
  answer: { bn: string; en: string };
  /** Where to go to actually do it. */
  route?: string;
}

/**
 * The parts of the app that are not modules — the spine everything else hangs off.
 *
 * Written as answers a person would accept out loud, not as feature bullets: the question
 * behind "ব্যাকআপ" is almost never "does a backup feature exist", it is "how do I not lose
 * this", and the answer has to say where to tap.
 */
const CORE: KnowledgeEntry[] = [
  {
    id: 'what-is-apon',
    // Phrases, not bare words: "অ্যাপ" appears in half the questions people ask, and an
    // entry that answers all of them answers none of them well.
    keywords: ['আপন', 'apon', 'অ্যাপটা কী', 'অ্যাপটা কি', 'এই অ্যাপ', 'অ্যাপটি কী', 'পরিচয়',
      'what is this app', 'what can you do', 'কি কি পারো', 'কী কী পারো', 'কী কী পারেন', 'purpose', 'উদ্দেশ্য'],
    title: { bn: 'আপন কী', en: 'What Apon is' },
    answer: {
      bn: 'আপন আপনার নিজের জীবনের খাতা — টাস্ক, মনে রাখার কথা, দেনা-পাওনা, আয়-ব্যয় আর স্বাস্থ্য, সব এক জায়গায়। পুরোটাই আপনার ফোনে থাকে, কোনো সার্ভারে যায় না, ইন্টারনেট ছাড়াই চলে।',
      en: 'Apon is a book for your own life — tasks, things to remember, debts, money and health, all in one place. Everything stays on your phone, goes to no server, and works with no internet.',
    },
    route: '/',
  },
  {
    id: 'offline',
    keywords: ['অফলাইন', 'ইন্টারনেট', 'নেট', 'সার্ভার', 'ক্লাউড', 'অনলাইন', 'offline', 'internet', 'server', 'cloud', 'online'],
    title: { bn: 'অফলাইন মানে অফলাইন', en: 'Offline means offline' },
    answer: {
      bn: 'আপন কোনো সার্ভারে কিছু পাঠায় না। আপনার সব লেখা, ছবি ও হিসাব এই ফোনের ভেতরেই একটি ডেটাবেসে থাকে। ইন্টারনেট বন্ধ রাখলেও অ্যাপের সবকিছু আগের মতোই চলে — কারণ কোনো কিছুর জন্যই ইন্টারনেট লাগে না।',
      en: 'Apon sends nothing to any server. Everything you write, photograph or count lives in one database inside this phone. Turn the internet off and the whole app still works, because none of it needed the internet.',
    },
    route: '/doc?id=legal',
  },
  {
    id: 'privacy',
    keywords: ['গোপনীয়তা', 'প্রাইভেসি', 'নিরাপত্তা', 'নীতি', 'শর্ত', 'privacy', 'policy', 'terms', 'security', 'safe'],
    title: { bn: 'গোপনীয়তা', en: 'Privacy' },
    answer: {
      bn: 'কোনো অ্যাকাউন্ট নেই, কোনো ট্র্যাকিং নেই, কোনো বিজ্ঞাপন নেই। অনুমতি (ক্যামেরা, কনটাক্ট, নোটিফিকেশন) শুধু তখনই চাওয়া হয় যখন আপনি সেই কাজটি করতে যান, এবং না দিলেও বাকি অ্যাপ চলে। পুরো নীতি সেটিংস → গোপনীয়তা নীতিতে।',
      en: 'No account, no tracking, no ads. Permissions — camera, contacts, notifications — are asked only at the moment you use that feature, and refusing one leaves the rest of the app working. The full policy is in Settings → Privacy Policy.',
    },
    route: '/doc?id=legal',
  },
  {
    id: 'tasks',
    keywords: ['টাস্ক', 'কাজ', 'পরিকল্পনা', 'প্ল্যান', 'প্ল্যানিং', 'করণীয়', 'task', 'todo', 'plan', 'planning'],
    title: { bn: 'কাজ ও পরিকল্পনা', en: 'Tasks and planning' },
    answer: {
      bn: 'যা মনে এল ইনবক্সে ফেলে রাখুন, পরে পরিকল্পনা পাতায় দিন ঠিক করুন। বকেয়া, আজকের ও সময় অনুযায়ী ভাগ করা কাজ সেখানেই দেখা যায়। প্রতিটি কাজে সময়, গুরুত্ব, উপ-কাজ ও ছবি যোগ করা যায়।',
      en: 'Drop whatever comes to mind into the inbox, then give it a day on the Planning screen. Overdue, today, and time-of-day groups all live there. Every task can carry a time, a priority, subtasks and photos.',
    },
    route: '/planning',
  },
  {
    id: 'memory',
    keywords: ['মেমরি', 'মেমোরি', 'নোট', 'মনে', 'তথ্য', 'সেভ', 'memory', 'note', 'remember', 'save', 'fact'],
    title: { bn: 'মনে রাখার কথা', en: 'Memory' },
    answer: {
      bn: 'যা মনে রাখতে চান — পাসপোর্টের মেয়াদ, ওয়াইফাই পাসওয়ার্ড, কারও পছন্দ — মেমোরিতে লিখে রাখুন। পরে আমাকে জিজ্ঞেস করলে সেখান থেকেই উত্তর দেব।',
      en: 'Anything you want to keep — when a passport expires, the wifi password, what someone prefers — write it into Memory. Ask me later and I answer from exactly that.',
    },
    route: '/memory',
  },
  {
    id: 'backup',
    keywords: ['ব্যাকআপ', 'রিস্টোর', 'এক্সপোর্ট', 'backup', 'back up', 'restore', 'export', 'ব্যাক আপ'],
    title: { bn: 'ব্যাকআপ ও ফিরিয়ে আনা', en: 'Backup and restore' },
    answer: {
      bn: 'নিচের "আরও" → "ব্যাকআপ ও ফেরত আনা"-য় গিয়ে "ব্যাকআপ নিন" চাপলে সব কিছুর একটি ব্যাকআপ ফাইল তৈরি হয়। সাপ্তাহিক অটো-ব্যাকআপও চালু করা যায় এবং একটি ফোল্ডার বেছে দিলে সেখানে কপি জমা হয় — যা অ্যাপ মুছে ফেললেও থাকে।',
      en: 'Settings → Data & Backup → "Back up now" writes one ZIP of everything. You can also switch on a weekly automatic backup and pick a folder, so a copy survives even uninstalling the app.',
    },
    route: '/backup',
  },
  {
    id: 'trash',
    keywords: ['ট্র্যাশ', 'ডিলিট', 'মুছে', 'মুছা', 'ফেরত', 'বিন', 'trash', 'delete', 'deleted', 'undo', 'bin'],
    title: { bn: 'মুছে ফেলা জিনিস', en: 'Deleted things' },
    answer: {
      bn: 'কিছু মুছলে সেটি সাথে সাথে হারায় না — ৩০ দিন রাখা থাকে, আরও → মুছে ফেলা জিনিস থেকে ফিরিয়ে আনা যায়।',
      en: 'Nothing you delete disappears at once — it waits 30 days, and More → Deleted items brings it back.',
    },
    route: '/trash',
  },
  {
    id: 'reminders',
    keywords: ['রিমাইন্ডার', 'নোটিফিকেশন', 'অ্যালার্ম', 'আলার্ম', 'মনে করিয়ে', 'reminder', 'notification', 'alarm', 'notify'],
    title: { bn: 'রিমাইন্ডার', en: 'Reminders' },
    answer: {
      bn: 'কাজের সময় দিলে, ওষুধের সময় দিলে বা কিস্তির তারিখ দিলে আপন নিজেই মনে করিয়ে দেবে। কতক্ষণ আগে জানাবে সেটি সেটিংসে ঠিক করা যায়, আর নীরব সময় দিলে রাতে বাজবে না।',
      en: 'Give a task a time, a medicine an hour or an instalment a date and Apon reminds you. How far ahead is a setting, and quiet hours keep it silent at night.',
    },
    route: '/reminders',
  },
  {
    id: 'search',
    keywords: ['সার্চ', 'খুঁজ', 'খোঁজ', 'অনুসন্ধান', 'search', 'find', 'look'],
    title: { bn: 'খোঁজা', en: 'Search' },
    answer: {
      bn: 'একটি সার্চেই সব — কাজ, মেমোরি, দেনা, খরচ, ওষুধ, ডাক্তার। বাংলা বা ইংরেজি যেকোনোটিতে লিখুন।',
      en: 'One search covers everything — tasks, memories, debts, expenses, medicines, doctors. Type in Bengali or English.',
    },
    route: '/search',
  },
  {
    id: 'lock',
    keywords: ['অ্যাপ লক', 'লক', 'পিন', 'স্ক্রিনশট', 'app lock', 'lock', 'pin', 'screenshot'],
    title: { bn: 'অ্যাপ লক', en: 'App lock' },
    answer: {
      bn: 'সেটিংসে একটি পিন দিলে অ্যাপ খুললেই তা চাইবে। চাইলে স্ক্রিনশট বন্ধও করা যায়, তখন অন্য অ্যাপ বা কেউ স্ক্রিন রেকর্ড করলে কিছু দেখা যাবে না।',
      en: 'Set a PIN in Settings and the app asks for it on open. You can also block screenshots, so nothing shows in a screen recording.',
    },
    route: '/settings',
  },
  {
    id: 'ai-engine',
    keywords: ['এআই', 'ai', 'মডেল', 'llm', 'ইঞ্জিন', 'বুদ্ধি', 'model', 'engine', 'intelligence'],
    title: { bn: 'আপন কীভাবে বোঝে', en: 'How Apon understands' },
    answer: {
      bn: 'আমি একটি নিয়মভিত্তিক ইঞ্জিন — পুরোপুরি এই ফোনে চলি, কোনো ইন্টারনেট লাগে না। চাইলে সেটিংস থেকে একটি ঐচ্ছিক অন-ফোন মডেল যোগ করা যায়, সেটিও অফলাইনেই চলে।',
      en: 'I am a rule-based engine running entirely on this phone, with no internet. If you want more, Settings lets you add an optional on-device model — also fully offline.',
    },
    route: '/doc?id=ai-guide',
  },
  {
    id: 'language',
    keywords: ['ভাষা', 'বাংলা', 'ইংরেজি', 'থিম', 'ডার্ক', 'লাইট', 'ফন্ট', 'language', 'bengali', 'english', 'theme', 'dark', 'light'],
    title: { bn: 'ভাষা ও চেহারা', en: 'Language and look' },
    answer: {
      bn: 'সেটিংস থেকে বাংলা বা ইংরেজি বেছে নিন, আর লাইট/ডার্ক/সিস্টেম থিম বদলান। সময় ১২ না ২৪ ঘণ্টায় দেখবেন সেটিও সেখানেই।',
      en: 'Settings switches between Bengali and English, and between light, dark and system themes. Whether time reads in 12 or 24 hours is there too.',
    },
    route: '/settings',
  },
  {
    id: 'timezone',
    // "ঢাকা" and "তারিখ" on their own belong to half the questions ever asked here, so
    // this entry answers only when the question is actually about the clock the app runs on.
    keywords: ['সময় অঞ্চল', 'টাইম জোন', 'timezone', 'time zone', 'gmt', 'ঢাকার সময়', 'কোন সময় ধরে'],
    title: { bn: 'সময় অঞ্চল', en: 'Time zone' },
    answer: {
      bn: 'অ্যাপের সব তারিখ, মাস আর বকেয়ার হিসাব ঢাকার সময় (GMT+6) ধরে হয় — ফোন অন্য দেশে থাকলেও, যাতে দিন বদলে গিয়ে হিসাব উল্টে না যায়।',
      en: 'Every date, month and overdue count is worked out in Dhaka time (GMT+6), even if the phone is elsewhere, so a day never shifts under your figures.',
    },
    route: '/settings',
  },
  {
    id: 'modules',
    keywords: ['মডিউল', 'অংশ', 'চালু', 'বন্ধ', 'module', 'modules', 'enable', 'disable', 'turn'],
    title: { bn: 'মডিউল চালু-বন্ধ', en: 'Turning parts on and off' },
    answer: {
      bn: 'আপনার যেটা দরকার নেই সেটা রাখার দরকার নেই। আরও → মডিউল থেকে দেনা, আয়-ব্যয় বা স্বাস্থ্য চালু বা বন্ধ করুন — বন্ধ করলে হোম থেকেও সরে যাবে, কিন্তু ডেটা মুছবে না।',
      en: 'You do not have to keep what you do not need. More → Modules turns debt, money or health on and off — off also removes it from Home, and never deletes anything.',
    },
    route: '/modules',
  },
  {
    id: 'demo',
    keywords: ['ডেমো', 'নমুনা', 'উদাহরণ', 'দেখতে', 'demo', 'sample', 'example', 'try'],
    title: { bn: 'ডেমো ডেটা', en: 'Demo data' },
    answer: {
      bn: 'অ্যাপটা ভরা অবস্থায় দেখতে চাইলে আরও → অ্যাপ ঠিক আছে কি না থেকে ডেমো ডেটা যোগ করুন — সব মডিউলে নমুনা ঢুকবে। এক চাপে আবার পুরোটা মুছেও ফেলা যায়, আপনার নিজের লেখা কিছু হারায় না।',
      en: 'To see the app full rather than empty, More → Is the app all right adds demo data across every module. One tap removes all of it again, and nothing you wrote yourself is touched.',
    },
    route: '/diagnostics',
  },
  {
    id: 'attachments',
    keywords: ['ছবি', 'ক্যামেরা', 'ফাইল', 'অ্যাটাচমেন্ট', 'রিপোর্ট', 'ডকুমেন্ট', 'photo', 'camera', 'file', 'attachment', 'report', 'document'],
    title: { bn: 'ছবি ও ফাইল', en: 'Photos and files' },
    answer: {
      bn: 'কাজ, মেমোরি, দেনার কাগজ বা পরীক্ষার রিপোর্টের সাথে ছবি ও ফাইল রাখা যায়। ছবিগুলো অ্যাপের নিজের জায়গায় কপি হয়ে যায়, তাই গ্যালারি থেকে মুছলেও থেকে যায়।',
      en: 'Tasks, memories, loan papers and test reports can all carry photos and files. Each one is copied into the app’s own storage, so deleting it from the gallery does not lose it.',
    },
  },
  {
    id: 'widget',
    keywords: ['উইজেট', 'হোমস্ক্রিন', 'শর্টকাট', 'widget', 'shortcut', 'homescreen'],
    title: { bn: 'উইজেট ও দ্রুত যোগ', en: 'Widget and quick add' },
    answer: {
      bn: 'ফোনের হোমস্ক্রিনে আপনের উইজেট বসালে অ্যাপ না খুলেই কাজ বা খরচ যোগ করা যায়। নোটিফিকেশনে সবসময় থাকা একটি "দ্রুত যোগ" টাইলও সেটিংস থেকে চালু করা যায়।',
      en: 'Put the Apon widget on your phone’s home screen and add a task or an expense without opening the app. Settings can also keep a "quick add" tile in your notifications.',
    },
  },
  {
    // This is the single most common "the app is broken" report that is not a bug at all:
    // voice worked while the connection was on, then stopped the moment it went off. The
    // cause is an Android fact, not an Apon one, so the assistant has to be able to say it
    // plainly rather than the person concluding the feature itself does not work offline.
    id: 'voice',
    keywords: ['ভয়েস', 'মাইক', 'বলে', 'কথা বলে', 'শুনতে পারছে না', 'ভাষার প্যাকেট',
      'voice', 'microphone', 'mic', 'speech', 'speak', 'offline voice', 'language pack'],
    title: { bn: 'অফলাইনে ভয়েস', en: 'Offline voice' },
    answer: {
      bn: 'বলে লেখা ফোনের নিজের ভয়েস সেবা দিয়ে হয়, অ্যাপ কিছু পাঠায় না। ইন্টারনেট ছাড়া কাজ করতে বাংলা ভাষার প্যাকেটটি ফোনে একবার নামানো থাকতে হয় — সেটিংস → পারমিশন-এ "ভয়েস ভাষার প্যাকেট" এ চেপে একবার নামিয়ে নিলে এরপর থেকে ইন্টারনেট পুরোপুরি বন্ধ রেখেও বলে লেখা যাবে। প্যাকেট না থাকলে ভয়েস শুধু ইন্টারনেট থাকা অবস্থাতেই কাজ করবে।',
      en: 'Speaking uses the phone’s own voice service; nothing is sent anywhere. To work with no connection, the Bengali language pack has to be on the phone once — fetch it from Settings → Permissions → "Offline voice language pack", and from then on speaking works with the connection fully off. Without the pack, voice only works while you have a connection.',
    },
    route: '/permissions',
  },
];

/** Human-readable knowledge about a module, taken from what the module itself declares. */
function moduleEntries(): KnowledgeEntry[] {
  return allModules().map((module) => ({
    id: `module-${module.id}`,
    keywords: module.factKeywords?.() ?? [module.id],
    title: { bn: module.title('bn'), en: module.title('en') },
    answer: {
      bn: `${module.title('bn')} — ${module.description?.('bn') ?? ''} খুলতে হোম থেকে ${module.title('bn')} কার্ডে চাপ দিন।`.trim(),
      en: `${module.title('en')} — ${module.description?.('en') ?? ''} Open it from the ${module.title('en')} card on Home.`.trim(),
    },
    route: module.route,
  }));
}

/** Everything আপন knows about the app, modules included. */
export function appKnowledge(): KnowledgeEntry[] {
  return [...CORE, ...moduleEntries()];
}

/**
 * Normalised for matching: lowercase, punctuation gone, Bengali intact.
 *
 * `\p{M}` matters more than it looks. Bengali vowel signs are combining marks, not
 * letters, so a class of `\p{L}\p{N}` alone quietly strips them — "কেমন" becomes "কমন"
 * and "মনে" becomes "মন", after which words match each other that share no meaning at all.
 */
const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ');

/**
 * The entry that best answers `question`, or null when nothing is a real match.
 *
 * Scoring is deliberately blunt — a keyword either appears in the question or it does
 * not. Something cleverer would produce confident answers to questions this file cannot
 * actually answer, and a wrong confident answer costs more than an honest "I don't know".
 */
export function findKnowledge(question: string, minScore = 1): KnowledgeEntry | null {
  const haystack = ` ${norm(question)} `;
  let best: { entry: KnowledgeEntry; score: number } | null = null;
  for (const entry of appKnowledge()) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const needle = norm(keyword).trim();
      if (needle.length < 2) continue;
      const at = haystack.indexOf(` ${needle}`);
      if (at < 0) continue;
      // Bengali glues its case endings on: "সার্ভার" arrives as "সার্ভারে", "ব্যাকআপ" as
      // "ব্যাকআপের". Requiring a clean word boundary would miss almost every real
      // question, so a short tail still counts as the same word — a long one does not.
      const rest = haystack.slice(at + 1 + needle.length);
      const tail = rest.slice(0, rest.search(/\s/u) < 0 ? rest.length : rest.search(/\s/u));
      if (tail.length <= 3) score += 2 + Math.min(4, Math.floor(needle.length / 3));
      else if (needle.length >= 5) score += 1;
    }
    if (score >= minScore && (!best || score > best.score)) best = { entry, score };
  }
  return best?.entry ?? null;
}

/** Is the question about the app itself rather than about the user's own records? */
export function looksLikeAppQuestion(question: string): boolean {
  const q = norm(question);
  const asks = [
    'কি কি', 'কী কী', 'কিভাবে', 'কীভাবে', 'কোথায়', 'পারো', 'পারেন', 'পারবে', 'কেমন করে',
    'how', 'where', 'what can', 'can you', 'can i', 'is there', 'does it',
  ];
  return asks.some((a) => q.includes(norm(a)));
}

/**
 * What to say when there is genuinely no answer.
 *
 * The old line — "I couldn't find anything saved about that" — was true but unhelpful: it
 * blamed the user's notes for a question that may never have been about their notes. This
 * says what was searched, why it came up empty, and what I *can* do instead, because an
 * assistant that cannot help should at least leave you knowing where to go next.
 */
export function explainLimit(question: string, language: AppLanguage): string {
  const bn = language === 'bn';
  const names = allModules().map((m) => m.title(bn ? 'bn' : 'en'));
  const areas = bn
    ? ['কাজ ও পরিকল্পনা', 'মনে রাখার কথা', ...names].join(', ')
    : ['tasks and planning', 'memory', ...names].join(', ');

  if (looksLikeAppQuestion(question)) {
    return bn
      ? `এটা আমি ঠিক পারছি না — কারণ প্রশ্নটা অ্যাপের যে অংশগুলো আমি চিনি তার বাইরে। আমি সাহায্য করতে পারি: ${areas}, ব্যাকআপ, রিমাইন্ডার, গোপনীয়তা ও সেটিংস নিয়ে। অন্যভাবে জিজ্ঞেস করলে চেষ্টা করব।`
      : `I genuinely can't answer that one — it falls outside the parts of the app I know. I can help with ${areas}, backup, reminders, privacy and settings. Ask it another way and I will try again.`;
  }
  return bn
    ? `এটা আমি পারছি না — এই বিষয়ে আপনার সেভ করা কিছু নেই, আর অ্যাপের কোনো অংশের সাথেও মিলল না। আমি শুধু এই ফোনে যা আছে তা-ই দেখতে পারি, ইন্টারনেটে খুঁজতে পারি না — সেটাই আমার সীমা। মেমোরিতে লিখে রাখলে পরের বার উত্তর দিতে পারব।`
    : `I can't answer that one — you have nothing saved about it, and it did not match a part of the app either. I can only look at what is on this phone; I cannot search the internet, and that is my limit. Write it into Memory and I can answer next time.`;
}
