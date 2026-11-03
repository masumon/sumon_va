import { formatBangladeshDate } from '../i18n/date-time';
// In-app documents — read inside the app, never opened externally.
// Rendered by app/doc.tsx. Bilingual; `code` blocks stay verbatim.

export type DocBlock =
  | { t: 'h1'; bn: string; en: string }
  | { t: 'h2'; bn: string; en: string }
  | { t: 'h3'; bn: string; en: string }
  | { t: 'p'; bn: string; en: string; muted?: boolean }
  | { t: 'li'; bn: string; en: string }
  | { t: 'code'; text: string }
  | { t: 'rule' };

export type DocId = 'ai-guide' | 'legal' | 'about';

/**
 * Why Apon exists.
 *
 * Kept as a document rather than a paragraph on a settings screen because it is the thing
 * every other decision in this app has to answer to. When a feature and this page
 * disagree, the feature is wrong.
 */
const ABOUT: DocBlock[] = [
  { t: 'h1', bn: 'আপন কী, আর কেন', en: 'What Apon is, and why' },
  { t: 'p', bn: 'আপন আপনার নিজের জীবনের খাতা। যে কাজগুলো করতে হবে, যে কথাগুলো মনে রাখতে হবে, কার কাছে কত দেনা, মাসে কত এল আর কত গেল, কোন ওষুধ কখন — সব এক জায়গায়, এক অ্যাপে।', en: 'Apon is a book for your own life. What you have to do, what you have to remember, who you owe and what you are owed, what came in and what went out this month, which medicine at which hour — all in one place, in one app.' },

  { t: 'h2', bn: 'লক্ষ্য', en: 'The goal' },
  { t: 'p', bn: 'একজন সাধারণ মানুষ যেন তার নিজের হিসাব নিজে রাখতে পারেন — কোনো অ্যাকাউন্ট না খুলে, কারও সার্ভারে কিছু না পাঠিয়ে, ইন্টারনেট না থাকলেও।', en: 'That an ordinary person can keep their own accounts themselves — without opening an account, without sending anything to anyone’s server, and without needing the internet.' },

  { t: 'h2', bn: 'উদ্দেশ্য', en: 'What it sets out to do' },
  { t: 'li', bn: 'হিসাব সঠিক রাখা। টাকা কোথাও হারাবে না, কোথাও দুইবার গোনা হবে না। এক জায়গায় কমলে অন্য জায়গায় তার প্রভাব ঠিকঠাক পড়বে।', en: 'Keep the arithmetic honest. No money vanishes, nothing is counted twice, and what falls in one place shows up correctly in another.' },
  { t: 'li', bn: 'সময়মতো মনে করিয়ে দেওয়া — কিস্তির দিন, ওষুধের সময়, ডাক্তারের ফলো-আপ।', en: 'Remind you on time — the instalment date, the medicine hour, the doctor’s follow-up.' },
  { t: 'li', bn: 'বাংলায় বোঝা ও বলা। সংখ্যা বাংলা অঙ্কে, টাকা লাখ-কোটির নিয়মে, তারিখ ঢাকার সময়ে।', en: 'Speak and understand Bengali. Bengali numerals, lakh-and-crore grouping, dates in Dhaka time.' },
  { t: 'li', bn: 'যা দরকার নেই তা না রাখা। প্রতিটি মডিউল চালু বা বন্ধ করা যায়।', en: 'Not force what you do not need. Every module can be switched on or off.' },
  { t: 'li', bn: 'কিছু না হারানো। মুছে ফেলা জিনিস ৩০ দিন পর্যন্ত ফেরত আনা যায়, আর চালু করলে প্রতি সপ্তাহে নিজে থেকেই ব্যাকআপ হয়।', en: 'Lose nothing. Deleted things can be brought back for 30 days, and once you turn it on, a backup runs on its own every week.' },

  { t: 'h2', bn: 'অফলাইন মানে অফলাইন', en: 'Offline means offline' },
  { t: 'p', bn: 'এটি কোনো বিপণনের কথা নয়, গঠনের কথা। অ্যাপে কোনো সার্ভার নেই, কোনো অ্যাকাউন্ট নেই, কোনো সিঙ্ক নেই। ফ্লাইট মোডে সব ফিচার আগের মতোই চলে — কারণ কোনো ফিচারই ইন্টারনেটের উপর দাঁড়িয়ে নেই। একমাত্র ব্যতিক্রম কথা-থেকে-লেখা, যেটি ফোনের নিজের ভয়েস সেবা ব্যবহার করে; সেটিও ঐচ্ছিক।', en: 'This is a statement about how it is built, not how it is sold. There is no server, no account and no sync. In flight mode every feature works exactly as before, because no feature was ever standing on the internet. The one exception is speech-to-text, which uses the phone’s own voice service — and that is optional.' },

  { t: 'h2', bn: 'আপন — সহকারী', en: 'Apon — the assistant' },
  { t: 'p', bn: 'অ্যাপের ভেতরের সহকারীর নামও আপন। আপনি লিখে বা বলে কাজ ও মেমোরি তৈরি করতে পারেন, আর অ্যাপের যেকোনো বিষয়ে প্রশ্ন করতে পারেন। যা সে পারে না, সেটি স্পষ্ট করে বলে দেয় — কারণসহ। কোনো অনুমানভিত্তিক উত্তর দেয় না।', en: 'The assistant inside the app is also called Apon. You can type or speak a task or a memory, and you can ask it anything about the app. What it cannot do, it says plainly — with the reason. It does not guess.' },

  { t: 'h2', bn: 'কে বানিয়েছে', en: 'Who made it' },
  { t: 'p', bn: 'আপন তৈরি করেছেন SUMON, ডিজাইন করেছেন MD ABDUR RAHMAN FAHIM। প্রশ্ন বা পরামর্শ: info@aboenterprise.com', en: 'Apon is made by SUMON and designed by MD ABDUR RAHMAN FAHIM. Questions or suggestions: info@aboenterprise.com', muted: true },
];

const YEAR = new Date().getFullYear();
const EFFECTIVE_ISO = '2026-09-07';
const EFFECTIVE_BN = formatBangladeshDate(EFFECTIVE_ISO, 'bn');
const EFFECTIVE_EN = formatBangladeshDate(EFFECTIVE_ISO, 'en');

// Written for someone who has never heard the word "model" — every step says what to tap
// and what they will see. The technical reasoning lives in the code, not here.
const AI_GUIDE: DocBlock[] = [
  { t: 'p', bn: 'আপন AI ছাড়াই আপনার সব কাজ করে — কাজ মনে রাখা, টাকার হিসাব, প্রশ্নের উত্তর। চাইলে একটা ছোট AI যোগ করতে পারেন; তখন আপন-এর উত্তরগুলো আরও স্বাভাবিক ভাষায় লেখা হবে।', en: 'Apon does everything without an AI — remembering tasks, keeping accounts, answering questions. If you like, you can add a small AI; Apon then writes its answers in more natural language.' },
  { t: 'p', bn: 'AI পুরোপুরি এই ফোনেই চলে। আপনার কোনো প্রশ্ন, উত্তর বা তথ্য কোথাও পাঠানো হয় না।', en: 'The AI runs entirely on this phone. None of your questions, answers or information is sent anywhere.' },

  { t: 'h2', bn: 'কী কী লাগবে', en: 'What you need' },
  { t: 'li', bn: 'Wi-Fi সংযোগ — AI-এর ফাইলটা ১ থেকে ২ GB-এর মতো বড়।', en: 'A Wi-Fi connection — the AI file is about 1 to 2 GB.' },
  { t: 'li', bn: 'ফোনে ফাঁকা জায়গা — কতটা লাগবে, AI পাতা নিজেই বলে দেবে।', en: 'Free space on the phone — the AI page tells you how much.' },
  { t: 'li', bn: '১৫ থেকে ৩০ মিনিট সময় — বেশিরভাগ সময় যায় ফাইল নামাতে।', en: '15 to 30 minutes — most of it is the download.' },

  { t: 'h2', bn: 'ধাপ ১ — AI বেছে নিয়ে নামান', en: 'Step 1 — Choose an AI and download it' },
  { t: 'li', bn: 'সেটিংস → "নিজের AI মডেল যোগ করুন" খুলুন।', en: 'Open Settings → "Add your own AI model".' },
  { t: 'li', bn: 'নিচে "AI যোগ করুন — সহজ ৩ ধাপ" অংশে আপনার ফোন দেখে বেছে দেওয়া AI-গুলো পাবেন। ⭐ চিহ্ন দেওয়াটা আপনার ফোনের জন্য সবচেয়ে ভালো।', en: 'Further down, under "Add an AI — 3 easy steps", you will find AIs picked for your phone. The one with a ⭐ suits your phone best.' },
  { t: 'li', bn: '"ডাউনলোড করুন" চাপুন। ফোনের ব্রাউজার খুলে ফাইল নামা শুরু হবে — কতটা হলো, উপরের নোটিফিকেশন-এ দেখবেন। পুরো শেষ না হওয়া পর্যন্ত অপেক্ষা করুন।', en: 'Tap "Download". The phone’s browser opens and starts fetching the file — progress shows in the notification bar. Wait until it is completely finished.' },

  { t: 'h2', bn: 'ধাপ ২ — অ্যাপে যোগ করুন', en: 'Step 2 — Add it to the app' },
  { t: 'li', bn: 'আবার আপনের AI পাতায় ফিরে "মডেল ফাইল বেছে নিন" চাপুন।', en: 'Come back to Apon’s AI page and tap "Choose a model file".' },
  { t: 'li', bn: '"Downloads" খুলুন, আর যে ফাইলটা এইমাত্র নামিয়েছেন সেটা চাপুন (নামের শেষে .gguf লেখা থাকে)।', en: 'Open "Downloads" and tap the file you just downloaded (its name ends in .gguf).' },
  { t: 'li', bn: 'অ্যাপ ফাইলটা নিজের কাছে তুলে রাখবে — কয়েক মিনিট লাগতে পারে, অ্যাপ বন্ধ করবেন না।', en: 'The app copies the file in — this can take a few minutes; do not close the app.' },

  { t: 'h2', bn: 'ধাপ ৩ — যাচাই করে চালু করুন', en: 'Step 3 — Check it and switch it on' },
  { t: 'li', bn: '"যাচাই করুন" চাপুন। অ্যাপ আপনার ফোন পরীক্ষা করবে, তারপর AI একবার চালিয়ে দেখবে — প্রথমবার এক মিনিটের মতো লাগতে পারে।', en: 'Tap "Verify". The app checks your phone, then runs the AI once — the first time can take about a minute.' },
  { t: 'li', bn: 'শেষে "✓ আপন-এর সাথে যুক্ত" সবুজ দেখালে "আপন-এ AI চালু করুন" চাপুন। ব্যাস, হয়ে গেল।', en: 'When "✓ Connected to Apon" shows in green, tap "Use the AI in Apon". That’s it.' },
  { t: 'li', bn: 'এখন আপন-এর উপরে "AI চালু" দেখাবে, আর AI যে উত্তর লিখবে তার নিচে "✨ AI দিয়ে লেখা" থাকবে।', en: 'Apon now shows "AI on" at the top, and answers the AI wrote carry "✨ Written by the AI".' },

  { t: 'h2', bn: 'সমস্যা হলে', en: 'If something goes wrong' },
  { t: 'li', bn: 'নামানো মাঝপথে থেমে গেলে — Wi-Fi ঠিক আছে কিনা দেখে আবার "ডাউনলোড করুন" চাপুন।', en: 'The download stopped halfway — check Wi-Fi and tap "Download" again.' },
  { t: 'li', bn: '"ফোনে জায়গা কম" দেখালে — পুরোনো ভিডিও, ছবি বা না-লাগা অ্যাপ মুছে জায়গা খালি করুন।', en: '"Not enough space" — delete old videos, photos or unused apps to make room.' },
  { t: 'li', bn: 'যাচাইয়ে লাল চিহ্ন এলে — পাশে কারণ লেখা থাকে। বেশিরভাগ সময় তালিকার একটা ছোট AI নিলেই হয়ে যায়।', en: 'A red mark while verifying — the reason is written next to it. Most of the time, picking a smaller AI from the list fixes it.' },
  { t: 'li', bn: '"AI এখন বন্ধ রাখা হয়েছে" দেখালে — গতবার AI চালু করতে গিয়ে ফোনের মেমোরি কম পড়েছিল। ছোট AI নিন, অথবা আবার "যাচাই করুন" চাপুন।', en: '"AI has been switched off" — last time the phone ran short of memory starting the AI. Pick a smaller one, or tap "Verify" again.' },
  { t: 'li', bn: 'কোনো অবস্থাতেই আপনার তথ্য হারাবে না — AI কাজ না করলেও আপন আগের মতোই সব কাজ করে।', en: 'Nothing you have saved is ever lost — even if the AI does not work, Apon does everything as before.' },

  { t: 'h2', bn: 'AI সরাতে চাইলে', en: 'Removing the AI' },
  { t: 'li', bn: 'AI পাতায় "মডেল সরান" চাপুন।', en: 'Tap "Remove model" on the AI page.' },
  { t: 'li', bn: 'জায়গা ফেরত পেতে "Downloads"-এ নামানো ফাইলটাও মুছে দিন — অ্যাপে যোগ করার পর ওটা আর লাগে না।', en: 'To get the space back, also delete the downloaded file in "Downloads" — once added to the app it is no longer needed.' },
];

// Plain words for anyone (RC.2): no jargon, and every line true of the app as it ships
// today — checked against the manifest and the code on 2026-09-21. The email address is a
// tappable link (app/doc.tsx turns any address in a document into one).
const LEGAL: DocBlock[] = [
  { t: 'p', muted: true, bn: `সর্বশেষ হালনাগাদ ও কার্যকর তারিখ: ${EFFECTIVE_BN}`, en: `Last updated and effective: ${EFFECTIVE_EN}` },
  { t: 'p', bn: 'আপন আপনার নিজের খাতা — কাজ, মনে রাখার কথা, দেনা-পাওনা, আয়-ব্যয়, মানুষজন আর স্বাস্থ্যের হিসাব। সবকিছু থাকে শুধু আপনার ফোনে। নিচে সহজ ভাষায় লেখা আছে অ্যাপ কী রাখে, কী রাখে না, কোন অনুমতি কেন চায়, আর আপনার অধিকার কী।', en: 'Apon is your own notebook — tasks, things to remember, debts, money, people and health records. Everything stays on your phone only. Below, in plain words: what the app keeps, what it does not, which permissions it asks for and why, and your rights.' },

  { t: 'h1', bn: 'পর্ব ১ — গোপনীয়তা নীতি', en: 'Part 1 — Privacy Policy' },

  { t: 'h2', bn: '১. এক নজরে', en: '1. At a glance' },
  { t: 'li', bn: 'আপনার লেখা সবকিছু শুধু আপনার ফোনে থাকে। আমাদের কোনো সার্ভার নেই, অ্যাপ কিছুই কোথাও পাঠায় না।', en: 'Everything you write stays on your phone. We have no server; the app sends nothing anywhere.' },
  { t: 'li', bn: 'কোনো অ্যাকাউন্ট নেই, সাইন-ইন নেই, বিজ্ঞাপন নেই, আপনার উপর নজরদারি নেই।', en: 'No account, no sign-in, no ads, no tracking of you.' },
  { t: 'li', bn: 'তথ্য ফোনের বাইরে যায় শুধু তখন, যখন আপনি নিজে ব্যাকআপ বা কপি অন্য কোথাও রাখেন বা কাউকে পাঠান।', en: 'Information leaves the phone only when you yourself save a backup or a copy somewhere else, or send it to someone.' },
  { t: 'li', bn: 'অ্যাপ নিজে থেকে কোনো অনুমতি চালু করে না, কোনো সেটিংও বদলায় না — কী লাগবে তা জানায়, সিদ্ধান্ত আপনার।', en: 'The app never switches a permission or a setting on by itself — it tells you what is needed; the choice is yours.' },

  { t: 'h2', bn: '২. অ্যাপ আপনার ফোনে যা রাখে', en: '2. What the app keeps on your phone' },
  { t: 'li', bn: 'আপনার লেখা: কাজ ও তার সময়, মেমোরি, নোট, ট্যাগ।', en: 'What you write: tasks and their times, memories, notes, tags.' },
  { t: 'li', bn: 'টাকার হিসাব: আয়, খরচ, খাত, মানিব্যাগ, বাজেট, দেনা-পাওনা আর কিস্তি।', en: 'Money: income, spending, categories, wallets, budgets, debts and instalments.' },
  { t: 'li', bn: 'যাদের কথা আপনি লিখেছেন তাদের নাম, ফোন নম্বর, ইমেইল, ঠিকানা। কন্টাক্ট থেকে নিলে শুধু আপনার বেছে নেওয়া একজনের তথ্য আসে।', en: 'Names, phone numbers, emails and addresses of people you wrote about. Picking from contacts brings in only the one person you choose.' },
  { t: 'li', bn: 'স্বাস্থ্য: ওষুধ ও খাওয়ার সময়, ডাক্তার, পরীক্ষা, রিপোর্টের ছবি বা PDF, চিকিৎসার খরচ।', en: 'Health: medicines and their times, doctors, tests, report photos or PDFs, medical costs.' },
  { t: 'li', bn: 'আপনার যোগ করা ছবি, ভিডিও, PDF ও ফাইল — অ্যাপের নিজের গোপন ফোল্ডারে কপি হয়ে থাকে।', en: 'Photos, videos, PDFs and files you add — copied into the app’s own private folder.' },
  { t: 'li', bn: 'জায়গা: শুধু আপনি "জায়গা যোগ করুন" চাপলে সেই মুহূর্তের অবস্থান (প্রায় ১০০ মিটার পর্যন্ত আনুমানিক)।', en: 'Place: only when you tap "add place", your location at that moment (rounded to about 100 metres).' },
  { t: 'li', bn: 'অ্যাপ থেকে কাউকে কল বা মেসেজ করলে শুধু কখন করেছেন সেই সময় — কী বলেছেন বা লিখেছেন তা নয়।', en: 'If you call or message someone from the app, only when you did — never what was said or written.' },
  { t: 'li', bn: 'অ্যাপের সেটিং: ভাষা, আলো/অন্ধকার থিম, সময় অঞ্চল, নীরব সময়। অ্যাপ লকের পিন সরাসরি রাখা হয় না — এমনভাবে বদলে রাখা হয় যা থেকে আসল পিন আর বের করা যায় না।', en: 'App settings: language, light/dark theme, time zone, quiet hours. The app-lock PIN is never kept as is — only in a scrambled form the real PIN cannot be read back from.' },
  { t: 'li', bn: 'ফোনের কোম্পানির নাম (যেমন vivo, Samsung) — শুধু ফোনের ভেতরে পড়া হয়, আপনার ফোনের জন্য রিমাইন্ডারের সঠিক ধাপ দেখাতে। কোথাও পাঠানো হয় না।', en: 'The phone maker’s name (e.g. vivo, Samsung) — read on the phone only, to show the right reminder steps for your phone. Never sent anywhere.' },
  { t: 'li', bn: 'অ্যাপ কীভাবে আপনার অভ্যাস বোঝে তার ছোট হিসাব (যেমন "জিম" সাধারণত সকালের কাজ) — শুধু ফোনে।', en: 'Small counts of your habits so capture gets smarter (e.g. "gym" is usually a morning task) — on the phone only.' },

  { t: 'h2', bn: '৩. অ্যাপ যা কখনো নেয় না', en: '3. What the app never takes' },
  { t: 'li', bn: 'আপনার পুরো ফোনবুক নয়।', en: 'Not your whole address book.' },
  { t: 'li', bn: 'অ্যাপ বন্ধ থাকা অবস্থায় আপনার অবস্থান নয়, কোথায় কোথায় গেছেন তার ইতিহাসও নয়।', en: 'Not your location while the app is closed, nor any history of where you went.' },
  { t: 'li', bn: 'কল লগ বা এসএমএস নয় — এই অনুমতি অ্যাপ চায়ই না।', en: 'Not your call log or SMS — the app does not even ask for them.' },
  { t: 'li', bn: 'আপন নিজে মাইকের কোনো শব্দ রেকর্ড করে না, জমিয়েও রাখে না।', en: 'Apon itself never records or keeps any microphone sound.' },
  { t: 'li', bn: 'বিজ্ঞাপনের আইডি, ব্যবহারের পরিসংখ্যান বা অ্যাপ বন্ধ হয়ে যাওয়ার রিপোর্ট আমাদের কাছে আসে না।', en: 'No advertising ID, no usage statistics, no crash reports ever reach us.' },

  { t: 'h2', bn: '৪. কোন অনুমতি কেন লাগে', en: '4. Which permissions, and why' },
  { t: 'li', bn: 'নোটিফিকেশন — কাজ ও ওষুধের রিমাইন্ডার দেখাতে।', en: 'Notifications — to show task and medicine reminders.' },
  { t: 'li', bn: 'ঠিক সময়ে বাজা — অ্যাপ বন্ধ থাকলেও ঠিক যে মিনিটে দিয়েছেন সেই মিনিটে রিমাইন্ডার বাজাতে।', en: 'Exact-time alarms — so a reminder rings at the exact minute you set, even with the app closed.' },
  { t: 'li', bn: 'ব্যাটারি থেকে ছাড় ও অটো-স্টার্ট — ফোন যেন ব্যাটারি বাঁচাতে গিয়ে রিমাইন্ডার বন্ধ না করে দেয়, আর ফোন আবার চালু হলে রিমাইন্ডারগুলো আবার সেট হয়।', en: 'Battery exemption and auto-start — so the phone does not stop reminders to save battery, and re-sets them after a restart.' },
  { t: 'li', bn: 'মাইক্রোফোন — শুধু আপনি 🎤 চাপলে, কথা বলে লিখতে। কথা থেকে লেখা বানায় ফোনের নিজের ভয়েস সেবা (যেমন Google); ফোনে বাংলা অফলাইনে না থাকলে সেই সেবা ইন্টারনেট ব্যবহার করে — সেটা ফোনের সেবার নিজস্ব নিয়মে চলে। লেখাটা শুধু আপনার ফোনেই থাকে।', en: 'Microphone — only when you tap 🎤, to write by speaking. Speech is turned into text by the phone’s own voice service (such as Google); if the phone has no offline Bengali, that service uses the internet under its own terms. The text stays on your phone.' },
  { t: 'li', bn: 'ক্যামেরা — শুধু আপনি ছবি তুলতে চাপলে: রশিদ, প্রেসক্রিপশন, বা কাগজের লেখা পড়তে। ছবির লেখা পড়া হয় ফোনের ভেতরেই।', en: 'Camera — only when you tap to take a photo: a receipt, a prescription, or to read text on paper. Reading the text happens on the phone.' },
  { t: 'li', bn: 'ছবি ও ফাইল — শুধু আপনি কিছু যোগ করতে বা ব্যাকআপ রাখার জায়গা বাছতে চাপলে।', en: 'Photos and files — only when you choose something to add, or where to keep a backup.' },
  { t: 'li', bn: 'কন্টাক্ট — শুধু "কন্টাক্ট থেকে নিন" চাপলে; আপনি যাকে বাছেন শুধু তার তথ্য।', en: 'Contacts — only when you tap "pick from contacts"; only the person you choose.' },
  { t: 'li', bn: 'অবস্থান — শুধু আপনি "জায়গা যোগ করুন" চাপলে, সেই মুহূর্তে একবার।', en: 'Location — only when you tap "add place", once, at that moment.' },
  { t: 'li', bn: 'আঙুলের ছাপ বা ফোনের লক — শুধু অ্যাপ লক চালু করলে, অ্যাপ খুলতে।', en: 'Fingerprint or phone lock — only if you turn on the app lock, to open the app.' },
  { t: 'li', bn: 'কল — কল বোতাম চাপলে ফোনের ডায়ালার খোলে; এর জন্য আলাদা অনুমতি লাগে না।', en: 'Calls — the call button opens the phone’s dialler; no permission is needed for that.' },
  { t: 'p', bn: 'প্রতিটি অনুমতি কেন লাগে আর না দিলে কী বন্ধ থাকবে — আরও › অনুমতি পাতায় লেখা আছে। যেকোনো অনুমতি ফোনের সেটিংস থেকে বন্ধ করতে পারেন; অ্যাপ চলবে, শুধু সেই অংশটুকু কাজ করবে না।', en: 'Why each permission is needed and what stops without it is written on the More › Permissions page. You can turn any permission off in the phone’s settings; the app keeps working, only that part stops.' },

  { t: 'h2', bn: '৫. স্বাস্থ্যের তথ্য', en: '5. Health information' },
  { t: 'p', bn: 'ওষুধ, ডাক্তার, পরীক্ষা আর রিপোর্ট খুব ব্যক্তিগত তথ্য। এগুলোও বাকি সবকিছুর মতো শুধু আপনার ফোনে থাকে। অ্যাপ শুধু সাধারণ স্বাস্থ্য-তথ্য দেয় — রোগ নির্ণয় বা ওষুধের মাত্রা নয়; সিদ্ধান্তের আগে ডাক্তারের সাথে কথা বলুন।', en: 'Medicines, doctors, tests and reports are very personal. Like everything else they stay on your phone only. The app only gives general health information — never a diagnosis or a medicine dose; talk to a doctor before deciding.' },

  { t: 'h2', bn: '৬. আপন ও নিজের AI', en: '6. Apon and your own AI' },
  { t: 'p', bn: 'আপন আপনার কথা বোঝে ফোনের ভেতরেই। আপনি চাইলে নিজের নামানো একটি AI মডেল ফাইল যোগ করতে পারেন — সেটিও ফোনেই চলে, কিছু পাঠায় না। AI-এর সাধারণ জ্ঞানের উত্তর ভুল হতে পারে, তাই অ্যাপ সেটা আলাদা করে চিহ্ন দিয়ে দেখায়। আপনার নিজের তথ্য নিয়ে AI কখনো বানিয়ে উত্তর দেয় না।', en: 'Apon understands you on the phone itself. You may add an AI model file you downloaded yourself — it also runs on the phone and sends nothing. General-knowledge answers from the AI can be wrong, so the app marks them clearly. The AI never makes up answers about your own information.' },

  { t: 'h2', bn: '৭. ব্যাকআপ', en: '7. Backups' },
  { t: 'p', bn: 'আপনি যখন খুশি ব্যাকআপ নিতে পারেন। অটো-ব্যাকআপ শুরুতে বন্ধ থাকে — আপনি চালু করলে তবেই প্রতি সপ্তাহে একটি ব্যাকআপ রাখে, অ্যাপের ভেতরে আর আপনি Apon ফোল্ডার বেছে দিলে Documents › Apon-এও। পাসওয়ার্ড দিলে ব্যাকআপ তালাবদ্ধ থাকে — পাসওয়ার্ড ছাড়া কেউ খুলতে পারে না, আমরাও না; পাসওয়ার্ড ভুলে গেলে ফেরত আনা যাবে না। ব্যাকআপ অন্য অ্যাপ বা ক্লাউডে রাখলে সেখানে সেই জায়গার নিয়ম চলে।', en: 'You can take a backup whenever you like. Auto-backup starts switched off — only once you turn it on does it keep one every week, inside the app and, if you chose the Apon folder, in Documents › Apon as well. With a password the backup is locked — nobody can open it without the password, not even us; a forgotten password cannot be recovered. A backup you keep in another app or cloud follows that place’s rules.' },

  { t: 'h2', bn: '৮. অন্যদের তৈরি উপাদান', en: '8. Parts made by others' },
  { t: 'p', bn: 'অ্যাপ বানানো হয়েছে বিশ্বজুড়ে ব্যবহৃত খোলা (ওপেন-সোর্স) উপাদান দিয়ে, যেমন React Native, Expo, SQLite, আর ছবির লেখা পড়তে Google-এর ফোনের ভেতরে চলা ব্যবস্থা। এগুলো সব ফোনেই চলে; এতে কোনো বিজ্ঞাপন বা নজরদারি নেই।', en: 'The app is built from widely used open-source parts such as React Native, Expo and SQLite, and Google’s on-phone text reader for photos. All of it runs on the phone; none of it carries ads or tracking.' },

  { t: 'h2', bn: '৯. তথ্য মোছা', en: '9. Deleting your information' },
  { t: 'p', bn: 'আপনার তথ্য ততদিন থাকে যতদিন আপনি না মোছেন। যেকোনো জিনিস আলাদা করে মুছতে পারেন (মোছা জিনিস কিছুদিন “মুছে ফেলা জিনিস”-এ থাকে, চাইলে ফেরত আনা যায়)। অ্যাপ আনইনস্টল করলে বা অ্যাপের তথ্য মুছে দিলে ফোনের সবকিছু চলে যায় — আগে ব্যাকআপ নিয়ে রাখুন।', en: 'Your information stays until you delete it. You can delete any item (deleted items stay in “Deleted items” for a while and can be brought back). Uninstalling the app or clearing its data removes everything on the phone — take a backup first.' },

  { t: 'h2', bn: '১০. শিশু', en: '10. Children' },
  { t: 'p', bn: 'অ্যাপটি বড়দের নিজের হিসাব রাখার জন্য, ১৩ বছরের কম বয়সীদের জন্য নয়। কারও কাছ থেকে কোনো তথ্য আমাদের কাছে আসে না।', en: 'The app is for adults keeping their own records, not for children under 13. No information from anyone ever reaches us.' },

  { t: 'h2', bn: '১১. এই নীতি বদলালে', en: '11. If this policy changes' },
  { t: 'p', bn: 'নীতি বদলালে নতুন তারিখসহ অ্যাপের ভেতরেই দেখা যাবে।', en: 'If the policy changes, the new version with its date appears inside the app.' },

  { t: 'h2', bn: '১২. যোগাযোগ', en: '12. Contact' },
  { t: 'p', bn: 'প্রশ্ন, পরামর্শ বা অভিযোগ থাকলে ইমেইল করুন (চাপলেই ইমেইল খুলবে): info@aboenterprise.com', en: 'Questions, suggestions or complaints — email us (tap to open your email): info@aboenterprise.com' },

  { t: 'h1', bn: 'পর্ব ২ — ব্যবহারের শর্ত', en: 'Part 2 — Terms of Use' },

  { t: 'h2', bn: '১. ব্যবহারের অনুমতি', en: '1. Permission to use' },
  { t: 'p', bn: 'আপনি নিজের বা পরিবারের ফোনে আপন ব্যবহার করতে পারবেন। এই অনুমতি ব্যক্তিগত — অন্য কাউকে বিক্রি বা হস্তান্তর করা যায় না।', en: 'You may use Apon on your own or your family’s phones. This permission is personal — it cannot be sold or passed on to someone else.' },

  { t: 'h2', bn: '২. যা করা যাবে না', en: '2. What you may not do' },
  { t: 'li', bn: 'অ্যাপ বা এর অংশ নিজের বলে কপি, বিক্রি বা ভাড়া দেওয়া।', en: 'Copy, sell or rent the app or its parts as your own.' },
  { t: 'li', bn: 'আইন যতটুকু অনুমতি দেয় তার বাইরে অ্যাপ খুলে ভেতরের কোড বের করা বা নকল করা।', en: 'Take the app apart to extract or copy its code beyond what the law allows.' },
  { t: 'li', bn: 'কপিরাইট বা নির্মাতার নাম সরানো বা বদলানো।', en: 'Remove or change the copyright or the maker’s name.' },
  { t: 'li', bn: 'অ্যাপ দিয়ে আইন ভাঙা বা অন্যের ক্ষতি করা।', en: 'Use the app to break the law or harm others.' },

  { t: 'h2', bn: '৩. আপনার তথ্য আপনারই', en: '3. Your information is yours' },
  { t: 'p', bn: 'অ্যাপে আপনার লেখা ও রাখা সবকিছুর মালিক আপনি। সেগুলো আমাদের কাছে আসেই না, তাই আমরা তার কোনো অধিকার দাবি করি না।', en: 'You own everything you write and keep in the app. It never reaches us, so we claim no rights to it.' },

  { t: 'h2', bn: '৪. আপডেট', en: '4. Updates' },
  { t: 'p', bn: 'অ্যাপ সময়ের সাথে উন্নত হবে; নতুন সংস্করণে কোনো অংশ যোগ, বদল বা বাদ হতে পারে। আপডেটের আগে ব্যাকআপ নিয়ে রাখা ভালো।', en: 'The app will improve over time; a new version may add, change or remove parts. Taking a backup before updating is wise.' },

  { t: 'h2', bn: '৫. দায়িত্বের সীমা', en: '5. Limits of responsibility' },
  { t: 'p', bn: 'অ্যাপ যেমন আছে তেমনভাবে দেওয়া হচ্ছে। আমরা যত্ন নিয়ে বানিয়েছি, তবু ভুল বা তথ্য হারানো অসম্ভব নয় — তাই নিয়মিত ব্যাকআপ রাখুন। টাকা, স্বাস্থ্য বা আইনের গুরুত্বপূর্ণ সিদ্ধান্তের আগে অ্যাপের হিসাব মিলিয়ে নিন ও বিশেষজ্ঞের পরামর্শ নিন। আইন যতটুকু অনুমতি দেয়, এর ফলে হওয়া কোনো পরোক্ষ ক্ষতি বা তথ্য হারানোর দায় SUMON বা ABO ENTERPRISE-এর নয়।', en: 'The app is provided as it is. We built it with care, yet mistakes or data loss are not impossible — so keep regular backups. Check the app’s figures and ask an expert before important money, health or legal decisions. As far as the law allows, SUMON and ABO ENTERPRISE are not responsible for indirect loss or lost data arising from its use.' },

  { t: 'h2', bn: '৬. প্রযোজ্য আইন', en: '6. Governing law' },
  { t: 'p', bn: 'এই শর্ত বাংলাদেশের আইন অনুযায়ী চলবে। আপনার দেশের আইনে ক্রেতা হিসেবে যে অধিকার আছে, তা এতে কমে না।', en: 'These terms follow the law of Bangladesh. Any consumer rights the law of your country gives you are not reduced by them.' },

  { t: 'h1', bn: 'পর্ব ৩ — কপিরাইট', en: 'Part 3 — Copyright' },
  { t: 'p', bn: `© ${YEAR} SUMON। সর্বস্বত্ব সংরক্ষিত।`, en: `© ${YEAR} SUMON. All rights reserved.` },
  { t: 'p', bn: 'আপন-এর নাম, লোগো, নকশা, পর্দা ও লেখা SUMON-এর সম্পত্তি। লিখিত অনুমতি ছাড়া এগুলো এমনভাবে ব্যবহার করা যাবে না যাতে মনে হয় আমরা সমর্থন দিচ্ছি।', en: 'Apon’s name, logo, design, screens and text belong to SUMON. They may not be used, without written permission, in a way that suggests our endorsement.' },
  { t: 'p', bn: 'অন্যদের তৈরি খোলা (ওপেন-সোর্স) উপাদান তাদের নিজ নিজ লেখকের, তাদের নিজস্ব শর্তে ব্যবহৃত। চাইলে সেই শর্তের কপি পাঠানো হবে।', en: 'Open-source parts made by others belong to their authors and are used under their own terms. A copy of those terms is available on request.' },

  { t: 'rule' },
  { t: 'p', muted: true, bn: 'আপন — আপনার তথ্য শুধু আপনার ফোনে। যোগাযোগ: info@aboenterprise.com', en: 'Apon — your information stays on your phone. Contact: info@aboenterprise.com' },
];

export const DOCS: Record<DocId, { title: { bn: string; en: string }; subtitle: { bn: string; en: string }; blocks: DocBlock[] }> = {
  'ai-guide': {
    title: { bn: 'নিজের AI যোগ করুন', en: 'Add your own AI' },
    subtitle: { bn: 'সহজ নির্দেশিকা — প্রযুক্তি না জানলেও পারবেন', en: 'A simple guide — no technical knowledge needed' },
    blocks: AI_GUIDE,
  },
  about: {
    title: { bn: 'লক্ষ্য ও উদ্দেশ্য', en: 'Purpose and goals' },
    subtitle: { bn: 'আপন কী, আর কেন এভাবে বানানো', en: 'What Apon is, and why it is built this way' },
    blocks: ABOUT,
  },
  legal: {
    title: { bn: 'গোপনীয়তা নীতি ও শর্তাবলি', en: 'Privacy Policy & Terms' },
    subtitle: { bn: 'গোপনীয়তা · শর্ত · কপিরাইট', en: 'Privacy · Terms · Copyright' },
    blocks: LEGAL,
  },
};
