import type { AppLanguage } from '../i18n/date-time';

// "নতুন কী আছে" — one entry for the release the reader has, describing the whole app in
// plain words. Earlier release-candidate notes are gone on purpose (the user's request for
// the 1.0 release): a person opening this page wants to know what the app does, not how it
// got here. `version` is what the What's-new screen remembers as seen.

type Line = { bn: string; en: string };

export type ChangelogSection = { icon: string; title: Line; items: Line[] };

export type ChangelogEntry = {
  version: string;
  date: string; // ISO date, display-only
  headline: Line;
  items: Line[];
  /** The whole app, part by part. */
  sections?: ChangelogSection[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date: '2026-09-07',
    headline: { bn: 'আপন ১.০ — জীবনের সব হিসাব এক জায়গায়, শুধু আপনার ফোনে', en: 'Apon 1.0 — all of life’s records in one place, only on your phone' },
    items: [],
    sections: [
      {
        icon: 'robot-happy-outline',
        title: { bn: 'আপন — আপনার সহকারী', en: 'আপন — your assistant' },
        items: [
          { bn: 'বাংলায় লিখুন বা বলুন — কাজ, খরচ, আয়, ধার, মেমোরি সব এক লাইনে। বাংলা (৫০০) ও ইংরেজি (500) দুই সংখ্যাই বোঝে।', en: 'Type or speak in Bangla — tasks, spending, income, loans, notes, all in one line. Bangla and English digits both work.' },
          { bn: 'জিজ্ঞেস করুন: আজ/কাল/এই সপ্তাহে কী কাজ, সময় পেরোনো কাজ, হাতে কত টাকা, এই মাসে কত খরচ ও কোন টাকা থেকে, কার কাছে কত পাবেন, পরের ওষুধ কখন।', en: 'Ask: today’s, tomorrow’s or this week’s tasks, overdue ones, money on hand, this month’s spending and whose money paid, who owes what, your next dose.' },
          { bn: 'খরচ বা ধার লিখলে মানিব্যাগ ও টাকার উৎস জিজ্ঞেস করে নেয়; কাজ না পেলে সোজা বলে "পাওয়া যায়নি" — কিছু বানিয়ে বলে না।', en: 'Asks for the wallet and source when you record money; says plainly when something is not found — it never makes things up.' },
          { bn: 'জ্বর, সর্দি-কাশি, পেট খারাপ, মাথাব্যথা, প্রেসার বা ডায়াবেটিসে কী করবেন — সাধারণ পরামর্শ আর কখন ডাক্তার দেখাবেন (ডাক্তারের বিকল্প নয়)।', en: 'Fever, cold, upset stomach, headache, blood pressure or diabetes — general advice and when to see a doctor (not a substitute for one).' },
          { bn: 'বানান ভুল মনে হলে (যেমন "সকাব ৯টায়") আপন কিছু রাখার আগেই জিজ্ঞেস করে — "আপনি কি সকাল বোঝাতে চেয়েছেন?"; নিজে থেকে কখনো বদলায় না।', en: 'If a word looks mistyped (e.g. "সকাব at 9"), আপন asks before saving — "did you mean সকাল?" — and never changes it on its own.' },
          { bn: 'AI ধীর হলে, ফোনের RAM কম পড়লে বা বন্ধ হয়ে গেলে সাথে সাথে সহজ ভাষায় জানায় — কেন হলো আর কী করবেন (যেমন অন্য অ্যাপ বন্ধ করা); দরকারে ফোনের নোটিফিকেশনেও।', en: 'When the AI is slow, short of RAM or stops, you are told at once in plain words — why, and what to do (like closing other apps); by phone notification if needed.' },
          { bn: '"অ্যাপটা কীভাবে চালাব?" জিজ্ঞেস করলেই পুরো নির্দেশিকা। চাইলে নিজের AI মডেল যোগ করা যায় — তবু অ্যাপের হিসাব ও সংখ্যা AI কখনো বদলায় না।', en: 'Ask "how do I use the app?" for the full guide. You can add your own AI model — it never changes the app’s figures.' },
        ],
      },
      {
        icon: 'calendar-check-outline',
        title: { bn: 'কাজ ও পরিকল্পনা', en: 'Tasks and planning' },
        items: [
          { bn: 'সময় দিলে ঠিক সময়ে রিমাইন্ডার; প্রতিদিন, সাপ্তাহিক বা মাসিক কাজ; এক দিন বাদ দেওয়া বা অন্য দিনে সরানো যায়।', en: 'Reminders on time; daily, weekly or monthly tasks; skip one day or move a task to another.' },
          { bn: 'আজকের পরিকল্পনা, ইনবক্স, সময় পেরোনো কাজ আর ফোকাস — হোমে আজকের অগ্রগতি।', en: 'Today’s plan, inbox, overdue tasks and focus — today’s progress on Home.' },
        ],
      },
      {
        icon: 'notebook-outline',
        title: { bn: 'মেমোরি', en: 'Memories' },
        items: [
          { bn: 'পাসওয়ার্ড, নম্বর, মেয়াদ, দরকারি তথ্য — ট্যাগ ও ছবিসহ রাখুন; পরে আপনকে জিজ্ঞেস করলেই পাবেন।', en: 'Passwords, numbers, expiry dates, anything important — with tags and photos; ask আপন later.' },
          { bn: 'আর্কাইভ আর “মুছে ফেলা জিনিস” — ভুল করে মুছলেও ফেরত আনা যায়।', en: 'Archive and Deleted items — bring back anything deleted by mistake.' },
        ],
      },
      {
        icon: 'wallet-outline',
        title: { bn: 'টাকার হিসাব', en: 'Money' },
        items: [
          { bn: 'প্রতিটি লেনদেনে মানিব্যাগ (*) আর টাকা বের হলে উৎস (*) — আয়, ঋণ, উপহার, সঞ্চয় বা "অন্যান্য" (নিজে লিখুন)। ফর্মেই নতুন মানিব্যাগ।', en: 'Every entry names its wallet (*), and money going out its source (*) — income, loan, gift, savings or "other" in your words. New wallets right on the form.' },
          { bn: 'মাসের আয়, খরচ, খাত অনুযায়ী ভাগ, "টাকা কোথা থেকে গেল", মানিব্যাগের মধ্যে টাকা সরানো; পুরোনো লেনদেন "হিসাব ঠিক করুন"-এ ঠিক করুন।', en: 'Monthly income, spending, categories, whose money paid, transfers between wallets; fix old entries under "Fix records".' },
        ],
      },
      {
        icon: 'handshake-outline',
        title: { bn: 'দেনা-পাওনা', en: 'Debts and receivables' },
        items: [
          { bn: 'কার কাছে কত দেনা, কে কত দেবে — মানুষ ধরে হিসাব, কিস্তি, সুদ, ফেরতের তারিখ ও রিমাইন্ডার, ফাইল সংযুক্তি।', en: 'Who you owe and who owes you — by person, with instalments, interest, due dates, reminders and attachments.' },
          { bn: 'শোধের সময় কোন টাকা দিয়ে শোধ (ঋণ দিয়ে ঋণ শোধও), মাধ্যম "অন্যান্য" হলে নিজে লিখুন; ভুল হলে সংশোধন, সব লেনদেন একটা খাতায়।', en: 'Each repayment names whose money paid (even a loan repaying a loan); type your own method for "other"; correct mistakes; every movement in one ledger.' },
        ],
      },
      {
        icon: 'heart-pulse',
        title: { bn: 'স্বাস্থ্য', en: 'Health' },
        items: [
          { bn: 'ওষুধ ও ডোজের রিমাইন্ডার, ডাক্তার দেখানো, টেস্টের রিপোর্ট (PDF), প্রেসার-সুগার — পরিবারের সবার জন্য।', en: 'Medicine and dose reminders, doctor visits, test reports (PDF), blood pressure and sugar — for the whole family.' },
          { bn: 'ফি বা ওষুধের দাম দিলে টাকার হিসাবেও যায় — মানিব্যাগ ও উৎসসহ।', en: 'Fees and medicine costs reach the money book too — with wallet and source.' },
        ],
      },
      {
        icon: 'camera-outline',
        title: { bn: 'ছবি, ফাইল ও ছবি থেকে লেখা', en: 'Photos, files and reading text' },
        items: [
          { bn: 'সব জায়গায় একই "যোগ করুন" — ক্যামেরা, গ্যালারি বা ফাইল; ছবি দুই আঙুলে বড় করুন, শেয়ার করুন।', en: 'The same "Add" everywhere — camera, gallery or file; pinch to zoom, share.' },
          { bn: 'ছাপা কাগজের ছবি থেকে লেখা তুলুন — কোন লাইনগুলো রাখবেন বেছে নিন, ছবির ক্রমেই বসবে; দুই কলামের পাতা কলাম ধরে পড়ে।', en: 'Read text from a printed page — pick the lines to keep, in the page’s order; two-column pages are read column by column.' },
        ],
      },
      {
        icon: 'shield-lock-outline',
        title: { bn: 'নিরাপত্তা ও ব্যাকআপ', en: 'Privacy and backup' },
        items: [
          { bn: 'সব তথ্য শুধু আপনার ফোনে — কোনো অ্যাকাউন্ট লাগে না, ইন্টারনেট ছাড়াও চলে।', en: 'Everything stays on your phone — no account, works offline.' },
          { bn: 'অ্যাপ লক, স্ক্রিনশট বন্ধ, পাসওয়ার্ড-তালা দেওয়া ব্যাকআপ, সাপ্তাহিক অটো-ব্যাকআপ আর এক চাপে ফেরত আনা।', en: 'App lock, screenshot blocking, password-locked backups, weekly auto-backup and one-tap restore.' },
        ],
      },
      {
        icon: 'palette-outline',
        title: { bn: 'চেহারা ও ভাষা', en: 'Look and language' },
        items: [
          { bn: 'পুরো অ্যাপ সহজ বাংলায় (চাইলে ইংরেজি); সময় দেখায় সকাল-দুপুর-বিকাল-রাতে।', en: 'The whole app in plain Bangla (or English); times shown as morning, afternoon, evening, night.' },
          { bn: 'প্রতিটা অংশে "কীভাবে ব্যবহার করবেন?" নির্দেশিকা; নিচের বারে "আরও", আর যেকোনো পাতা থেকে ভাসমান "আপন" বোতাম (চেপে ধরে সরানো যায়)।', en: 'A "How to use this?" guide in every part; "More" in the tab bar and a floating আপন button on every main page (hold to move).' },
          { bn: 'লাইট, ডার্ক বা ফোনের মতো থিম; প্রথমবার খুললে তিন পাতার সহজ পরিচিতি; ডেমো ডেটা দিয়ে আগে দেখে নেওয়া যায়।', en: 'Light, dark or system theme; a three-screen welcome the first time; try it with demo data first.' },
        ],
      },
    ],
  },
];

export const LATEST_VERSION = CHANGELOG[0]?.version ?? '0.0.0';

export function changelogHeadline(entry: ChangelogEntry, language: AppLanguage): string {
  return entry.headline[language];
}
