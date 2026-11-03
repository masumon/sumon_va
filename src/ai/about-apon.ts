// "তোমাকে কে বানিয়েছে?", "তুমি কী কী পারো?", "ব্যবহার নির্দেশিকা দাও" — আপন about itself.
//
// Many of the people this app is for have never used an app like it. When they are stuck
// they will ask আপন, so আপন has to be able to say who made it, what it is for, what it can
// do, and walk them through the whole app in plain words (the user's request, rc.7).
//
// The manual is built from the same how-to lines আপন already answers with (app-guide.ts),
// so the manual and every other answer always name the same buttons and paths.

import { guideAnswer, type GuideTopic } from './app-guide';
import { symptomAnswer, symptomTopic, type SymptomTopic } from './health-advice';

// "ডিজাইন কে করেছে?", "ডিজাইনার কে?", "who designed you?" — answered with the makers.
const DESIGNER_Q = /(?:ডিজাইন|ডিজাইনার|গ্রাফিক্স).{0,12}(?:কে|কারা)|(?:কে|কারা).{0,12}(?:ডিজাইন|ডিজাইনার)|who\s+(?:designed|is\s+the\s+designer)|designer\s+of/iu;
export type AboutTopic = 'creator' | 'purpose' | 'manual' | 'contact' | 'identity' | 'privacy'
  | 'future' | 'audience' | 'benefits' | 'healthTips' | 'lifeTips' | SymptomTopic;

const SYMPTOM_TOPICS: readonly string[] = ['fever', 'cold', 'stomach', 'headache', 'pressure', 'diabetes', 'sick'];

const CREATOR = /(?:কে|কারা)\s*(?:বানিয়েছে|বানাইছে|বানিয়েছেন|তৈরি\s*করেছে|তৈরি\s*করেছেন|বানাল|বানালো|ডেভেলপ\s*করেছে)|নির্মাতা|ডেভেলপার|মালিক\s*কে|who\s+(?:made|built|created|developed)\s+(?:you|this|apon|the app)|\b(?:creator|developer|maker)\b/iu;
const PURPOSE = /(?:তোমার|আপনের|আপন-এর|অ্যাপের|এপের|এই\s*অ্যাপের)\s*(?:মূল\s*)?(?:উদ্দেশ্য|লক্ষ্য|কাজ\s*কী)|(?:কেন|কী\s*জন্য)\s*(?:বানানো|তৈরি)|what(?:'s| is)\s+(?:your|the app'?s?)\s+(?:purpose|goal)|why (?:were you|was this app) (?:made|built)/iu;
const MANUAL = /(?:ব্যবহার(?:ের)?\s*(?:নির্দেশিকা|নির্দশিকা|নিয়ম|পদ্ধতি|গাইড)|ইউজার\s*ম্যানুয়াল|ম্যানুয়াল|ব্যবহার\s*বিধি|কীভাবে\s*ব্যবহার|কিভাবে\s*ব্যবহার|কেমনে\s*ব্যবহার|(?:অ্যাপ|এপ|আপন)\S*\s*(?:কীভাবে|কিভাবে|কেমনে)\s*চালা(?:ব|বো|তে|ই)|(?:কীভাবে|কিভাবে)\s*চালাতে\s*হ|শুরু\s*থেকে\s*শেখাও|পুরো\s*অ্যাপ\s*বুঝিয়ে|user\s*(?:manual|guide)|how\s+(?:do|can)\s+i\s+use\s+(?:this|the)\s+app|teach me the app)/iu;
const CONTACT = /(?:নির্মাতা|ডেভেলপার|আপনাদের|কোম্পানি|অভিযোগ|পরামর্শ)\S*.*(?:যোগাযোগ|ইমেইল|ইমেল|মেইল)|(?:যোগাযোগ|ইমেইল)\s*(?:কীভাবে|কিভাবে|কোথায়)|\bcontact (?:the )?(?:developer|maker|you)\b|\bsupport email\b/iu;
const PRIVACY = /(?:আমার\s*)?(?:তথ্য|ডেটা|ডাটা)\s*(?:কোথায়\s*(?:থাকে|যায়|রাখা)|নিরাপদ|কেউ\s*দেখতে\s*পায়)|where (?:is|does) my data|is my data safe/iu;
const FUTURE = /(?:তোমার|আপনের|আপন-এর|অ্যাপের|এপের)\s*(?:ভবিষ্যৎ|ভবিষ্যত|ভভিষৎ)|ভবিষ্যতে\s*(?:কী|কি)\s*(?:আসবে|যোগ\s*হবে|থাকবে|আনবে)|নতুন\s*(?:কী|কি)\s*(?:ফিচার|সুবিধা)\s*(?:আসবে|আসছে)|\bfuture plans?\b|what'?s coming|\broadmap\b/iu;
const AUDIENCE = /(?:এই\s*অ্যাপ|অ্যাপটা|আপন)\S*\s*(?:কাদের|কার)\s*(?:জন্য|জন্যে)|কারা\s*(?:ব্যবহার\s*করবে|ব্যবহার\s*করতে\s*পারে)|who is (?:this|it|apon|the app) for/iu;
const BENEFITS = /(?:আমাকে\s*|মানুষকে\s*)?(?:কী|কি|কীভাবে|কিভাবে)\s*(?:সাহায্য|উপকার|সেবা)\s*(?:করতে\s*পারো|করবে|করে|করতে\s*পারে|দিতে\s*চায়|দেয়|দিতে\s*পারে)|(?:কেন|কী\s*জন্য)\s*(?:আপন|এই\s*অ্যাপ)?\s*ব্যবহার\s*করব|কতটা\s*(?:সহায়ক|কাজের|উপকারী)|জীবনে\s*(?:কী|কি)\s*কাজে|why should i use|how (?:can|does|will) (?:you|apon|this app|it) help/iu;
const HEALTH_TIPS = /(?:স্বাস্থ্য|শরীর)\S*\s*(?:ভালো\s*রাখ\S*|টিপস|পরামর্শ|বিষয়ে\s*তথ্য)|সুস্থ\s*থাক(?:তে|ার)|স্বাস্থ্য\s*সম্পর্কে|\bhealth tips?\b|\bstay healthy\b/iu;
const LIFE_TIPS = /(?:জীবনযাত্রা|জীবনযাপন|জীবনের)\S*\s*(?:মান|উন্নতি|উন্নত|পরামর্শ|টিপস)|ভালো\s*থাক(?:ার|তে)\s*(?:উপায়|পরামর্শ)|জীবন\s*(?:সুন্দর|গোছানো|গুছিয়ে)|\blife tips\b|\bimprove my life\b/iu;
// "তুমি কে?" stays small talk, which answers with the same identity text (conversation.ts).
const IDENTITY = /আপন\s*(?:অ্যাপ\s*)?কে(?![\p{L}\p{M}])|আপন\s*(?:অ্যাপ\s*)?কী(?![\p{L}\p{M}])|আপন\s*কি\s*জিনিস|what is apon/iu;

/** Which question about আপন this is, or null. Order: the most specific first. */
export function aboutAponTopic(text: string): AboutTopic | null {
  const t = text.normalize('NFC');
  // A health question ("জ্বর হলে কী করব?") is a question, never a task — rc.13 QA H06.
  const symptom = symptomTopic(t);
  if (symptom) return symptom;
  if (CONTACT.test(t)) return 'contact';
  if (CREATOR.test(t) || DESIGNER_Q.test(t)) return 'creator';
  if (MANUAL.test(t)) return 'manual';
  if (FUTURE.test(t)) return 'future';
  if (AUDIENCE.test(t)) return 'audience';
  if (PURPOSE.test(t)) return 'purpose';
  if (HEALTH_TIPS.test(t)) return 'healthTips';
  if (LIFE_TIPS.test(t)) return 'lifeTips';
  if (BENEFITS.test(t)) return 'benefits';
  if (PRIVACY.test(t)) return 'privacy';
  if (IDENTITY.test(t)) return 'identity';
  return null;
}

const CREATOR_BN = 'আমাকে (আপন অ্যাপ) তৈরি করেছেন SUMON, ডিজাইন করেছেন প্রধান ডিজাইনার MD ABDUR RAHMAN FAHIM, আর পেছনে আছে ABO ENTERPRISE। প্রশ্ন, পরামর্শ বা কোনো সমস্যা হলে ইমেইল করুন: info@aboenterprise.com। আরও তথ্য: নিচের "আরও" → "অ্যাপ সম্পর্কে ও গোপনীয়তা"।';
const CREATOR_EN = 'Apon was made by SUMON and designed by lead designer MD ABDUR RAHMAN FAHIM, powered by ABO ENTERPRISE. For questions, suggestions or problems, email info@aboenterprise.com. More: "More" at the bottom → "About and privacy".';

const PURPOSE_BN = 'আমার উদ্দেশ্য একটাই — একজন সাধারণ মানুষ যেন নিজের জীবনের সব হিসাব নিজে সহজে রাখতে পারেন: কী কাজ করতে হবে, কী মনে রাখতে হবে, টাকা কোথায় গেল, কার কাছে কত দেনা-পাওনা, কখন কোন ওষুধ। সব তথ্য শুধু আপনার ফোনেই থাকে — কোনো অ্যাকাউন্ট লাগে না, ইন্টারনেট ছাড়াও চলে। আমি সময়মতো মনে করিয়ে দিই, আর বাংলায় কথা বুঝি।';
const PURPOSE_EN = 'One purpose: that an ordinary person can keep all of life’s records easily by themselves — what to do, what to remember, where the money went, who owes whom, which medicine when. Everything stays only on your phone — no account, and it works without internet. I remind you on time, and I understand Bangla.';

const PRIVACY_BN = 'আপনার সব তথ্য শুধু এই ফোনেই থাকে। কোনো সার্ভার নেই, কোনো অ্যাকাউন্ট নেই — আমরাও দেখতে পাই না। ফোন হারালেও যেন তথ্য না হারায়, মাঝে মাঝে ব্যাকআপ নিন: নিচের "আরও" → "ব্যাকআপ ও ফেরত আনা"। চাইলে অ্যাপ লক দিয়ে অ্যাপ তালাবন্ধ রাখতে পারেন।';
const PRIVACY_EN = 'All your information stays only on this phone. No server, no account — not even we can see it. Take a backup now and then, so nothing is lost if anything happens to the phone: "More" at the bottom → "Backup and restore". You can also lock the app with App Lock.';


// The manual's chapters, in the order a new person meets them. Each body is the how-to
// line আপন already gives for that topic, so the manual can never drift from the answers.
const CHAPTERS: [GuideTopic, string, string][] = [
  ['apon', 'আপন বোতাম', 'The আপন button'],
  ['pageGuide', 'প্রতিটা পাতার নির্দেশিকা', 'Each page’s guide'],
  ['task', 'কাজ যোগ করা', 'Adding a task'],
  ['reminder', 'রিমাইন্ডার', 'Reminders'],
  ['memory', 'দরকারি তথ্য মনে রাখা (মেমোরি)', 'Remembering things (memories)'],
  ['money', 'আয়-ব্যয় লেখা', 'Writing down money'],
  ['wallet', 'মানিব্যাগ — কোথায় কত টাকা', 'Wallets — where the money is'],
  ['debt', 'দেনা-পাওনা', 'Debts and money owed'],
  ['medicine', 'ওষুধ', 'Medicines'],
  ['doctor', 'ডাক্তার ও টেস্ট', 'Doctor visits and tests'],
  ['attach', 'ছবি, রশিদ ও PDF রাখা', 'Photos, receipts and PDFs'],
  ['photoText', 'ছবি থেকে লেখা তোলা', 'Reading text from a photo'],
  ['search', 'কিছু খুঁজে পাওয়া', 'Finding anything'],
  ['calendar', 'ক্যালেন্ডার', 'Calendar'],
  ['backup', 'ব্যাকআপ — তথ্য হারাবে না', 'Backup — never lose anything'],
  ['restore', 'ব্যাকআপ থেকে ফেরত আনা', 'Restoring a backup'],
  ['export', 'এক্সেল বা প্রিন্টের জন্য কপি', 'A copy for Excel or printing'],
  ['lock', 'অ্যাপ লক', 'App Lock'],
  ['trash', 'ভুল করে মুছে ফেললে', 'If you deleted something by mistake'],
  ['permission', 'অনুমতি', 'Permissions'],
  ['theme', 'দেখতে কেমন লাগবে (থিম)', 'How it looks (theme)'],
  ['ai', 'নিজের AI মডেল (চাইলে)', 'Your own AI model (optional)'],
];

function manual(bn: boolean): string {
  const intro = bn
    ? 'আপন — সহজ ব্যবহার নির্দেশিকা\n\nসবচেয়ে সহজ উপায়: যেকোনো প্রধান পাতার ভাসমান গোল "আপন" বোতাম চেপে যা দরকার বাংলায় লিখুন বা মাইকে বলুন — কাজ, খরচ, প্রশ্ন, সব এক জায়গায়। না বুঝলে আমাকেই জিজ্ঞেস করুন।'
    : 'Apon — a simple user guide\n\nThe easiest way: tap the round floating "আপন" button on any main page and type or say what you need — tasks, money, questions, all in one place. If anything is unclear, just ask me.';
  const body = CHAPTERS.map(([topic, bnTitle, enTitle], i) => {
    const n = bn ? String(i + 1).replace(/\d/gu, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!) : String(i + 1);
    return `${n}. ${bn ? bnTitle : enTitle}\n${guideAnswer(topic, bn).text}`;
  }).join('\n\n');
  const outro = bn
    ? 'আপনার তথ্য শুধু এই ফোনেই থাকে। সমস্যা বা পরামর্শ: info@aboenterprise.com (নির্মাতা: SUMON · ডিজাইন: MD ABDUR RAHMAN FAHIM · ABO ENTERPRISE)।'
    : 'Your information stays only on this phone. Problems or suggestions: info@aboenterprise.com (made by SUMON · design by MD ABDUR RAHMAN FAHIM · ABO ENTERPRISE).';
  return `${intro}\n\n${body}\n\n${outro}`;
}

// Only what is really on the list for later (NEXT_VERSION.md) — said as a plan, never a promise.
const FUTURE_BN = 'সামনে যা নিয়ে ভাবা হচ্ছে (নিশ্চিত প্রতিশ্রুতি নয়, আপনার মতামতে বদলাতে পারে):\n• Google Play Store-এ আপনকে আনা, যাতে সহজে নামানো আর আপডেট করা যায়।\n• রিমাইন্ডারের পাশাপাশি নিজের মতো অ্যালার্ম সেট করার সুবিধা।\n• ট্যাবলেট আর ক্রোমবুকেও ঠিকঠাক চালানো।\n• আরও সহজ ও নির্ভুল বাংলা বোঝা।\nআপনি কী চান জানাতে ইমেইল করুন: info@aboenterprise.com — ব্যবহারকারীর চাওয়া দেখেই পরের কাজ ঠিক হয়।';
const FUTURE_EN = 'What is being considered next (a plan, not a promise — your feedback can change it):\n• Bringing Apon to the Google Play Store, for easy installs and updates.\n• Setting your own alarms, alongside reminders.\n• Running well on tablets and Chromebooks.\n• Understanding Bangla even better.\nTell us what you want: info@aboenterprise.com — what users ask for decides what comes next.';

const AUDIENCE_BN = 'আপন সবার জন্য, বিশেষ করে যারা সহজ একটা অ্যাপ চান:\n• পরিবার সামলান এমন মা-বাবা — সংসারের খরচ, বাচ্চাদের কাজ, বয়স্কদের ওষুধ।\n• ছোট ব্যবসায়ী ও দোকানদার — কার কাছে কত পাওনা, কাকে কত দেনা, কিস্তি।\n• চাকরিজীবী ও শিক্ষার্থী — কাজের তালিকা, মিটিং, দরকারি তথ্য।\n• বয়স্ক মানুষ — ওষুধের সময়, ডাক্তারের তারিখ, সহজ বাংলায় সব।\n• যারা ইন্টারনেট কম পান বা নিজের তথ্য অন্য কোথাও রাখতে চান না।\nপ্রযুক্তি না জানলেও চলে — বাংলায় লিখুন বা বলুন, বাকিটা আমি বুঝে নিই।';
const AUDIENCE_EN = 'Apon is for everyone, especially people who want something simple:\n• Parents running a household — family spending, children’s tasks, elders’ medicines.\n• Small shop and business owners — who owes what, what is owed, instalments.\n• Workers and students — to-do lists, meetings, important information.\n• Older people — medicine times, doctor dates, everything in simple Bangla.\n• Anyone with little internet, or who does not want their data elsewhere.\nNo tech skills needed — type or say it in Bangla, and I work out the rest.';

const BENEFITS_BN = 'একজন মানুষের প্রতিদিনের জীবনে আমি যেভাবে কাজে আসি:\n• ভুলে যাওয়ার চিন্তা থাকে না — বিল, কিস্তি, ওষুধ, ডাক্তার, মিটিং — সময়মতো মনে করিয়ে দিই।\n• টাকা কোথায় যায় বোঝা যায় — মাস শেষে দেখা যায় কোন খাতে বেশি খরচ, কত জমল।\n• দেনা-পাওনা নিয়ে ঝামেলা কমে — কে কবে কত দিল-নিল, সব তারিখসহ লেখা থাকে।\n• দরকারি তথ্য হাতের কাছে — পাসওয়ার্ড, নম্বর, মেয়াদ — জিজ্ঞেস করলেই পাই।\n• পরিবারের স্বাস্থ্যের খাতা — ওষুধ, প্রেসার-সুগার, টেস্টের রিপোর্ট এক জায়গায়।\n• মন হালকা থাকে — মাথায় সব ধরে রাখতে হয় না, আমি গুছিয়ে রাখি।\nসব কিছু আপনার ফোনেই, বাংলায়, ইন্টারনেট ছাড়াও। শুরু করতে বলুন: "ব্যবহার নির্দেশিকা দাও"।';
const BENEFITS_EN = 'How I help in everyday life:\n• No more forgetting — bills, instalments, medicines, doctors, meetings — reminded on time.\n• See where the money goes — at month end, which categories took the most and what was saved.\n• Fewer money disputes — who gave or took what, and when, is written down.\n• Important details at hand — passwords, numbers, expiry dates — just ask.\n• A family health record — medicines, blood pressure and sugar, test reports in one place.\n• A lighter mind — you do not have to hold it all in your head.\nAll on your phone, in Bangla, even offline. To begin, say: "user guide".';

// General, widely accepted advice only — never a diagnosis or a dose (not a doctor).
const HEALTH_BN = 'সুস্থ থাকার কিছু সাধারণ পরামর্শ:\n• দিনে ৮–১০ গ্লাস পানি পান করুন।\n• প্রতিদিন অন্তত ৩০ মিনিট হাঁটুন বা হালকা ব্যায়াম করুন।\n• রাতে ৭–৮ ঘণ্টা ঘুমান, একই সময়ে ঘুমানোর চেষ্টা করুন।\n• ভাত-তেল-লবণ-চিনি কম, শাকসবজি-ফল-ডাল বেশি খান।\n• ধূমপান ও জর্দা থেকে দূরে থাকুন।\n• ৪০ বছরের পর বছরে অন্তত একবার প্রেসার, সুগার ও কোলেস্টেরল পরীক্ষা করান।\n• ওষুধ ডাক্তারের দেওয়া সময় ও মাত্রায় খান — নিজে থেকে বন্ধ বা বদল করবেন না।\nবুকে ব্যথা, শ্বাসকষ্ট, হঠাৎ দুর্বলতা বা অজ্ঞান হলে দেরি না করে ডাক্তার বা হাসপাতালে যান।\n\nআমি ওষুধের রিমাইন্ডার দিতে, প্রেসার-সুগার লিখে রাখতে আর ডাক্তারের তারিখ মনে করিয়ে দিতে পারি। এগুলো সাধারণ তথ্য — ডাক্তারের পরামর্শের বিকল্প নয়।';
const HEALTH_EN = 'Some general advice for staying healthy:\n• Drink 8–10 glasses of water a day.\n• Walk or exercise lightly for at least 30 minutes daily.\n• Sleep 7–8 hours, at a regular time.\n• Less rice, oil, salt and sugar; more vegetables, fruit and lentils.\n• Stay away from smoking and chewing tobacco.\n• After 40, check blood pressure, sugar and cholesterol at least once a year.\n• Take medicines at the time and dose your doctor gave — do not stop or change them yourself.\nFor chest pain, breathlessness, sudden weakness or fainting, see a doctor or hospital without delay.\n\nI can remind you of medicines, keep blood pressure and sugar readings, and remind you of doctor dates. This is general information — not a substitute for a doctor’s advice.';

const LIFE_BN = 'জীবন আরও গোছানো ও ভালো রাখার কিছু সহজ পরামর্শ:\n• সকালে দিনের ৩টা জরুরি কাজ ঠিক করুন — আমাকে বললেই তালিকা হয়ে যাবে।\n• প্রতিটি খরচ লিখে রাখুন; মাস শেষে দেখুন কোথায় কমানো যায়।\n• আয়ের একটা অংশ (যেমন ১০%) মাসের শুরুতেই আলাদা করে জমান।\n• ধার দিলে বা নিলে সঙ্গে সঙ্গে লিখে রাখুন — সম্পর্ক ভালো থাকে।\n• পরিবারের সাথে সময় কাটান, ফোন একটু কম দেখুন।\n• দরকারি কাগজপত্রের ছবি আর তথ্য গুছিয়ে রাখুন, আর নিয়মিত ব্যাকআপ নিন।\n• প্রতিদিন একটু হাঁটা আর সময়মতো ঘুম — শরীর-মন দুটোই ভালো থাকে।\n\nআপনার নিজের হিসাব দেখে পরামর্শ চাইলে বলুন: "খরচ কমানোর পরামর্শ দাও"।';
const LIFE_EN = 'Some simple advice for a more organised, better life:\n• Each morning pick the day’s 3 important tasks — tell me and they become a list.\n• Write down every expense; at month end see where to cut.\n• Put part of your income (say 10%) aside at the start of each month.\n• Write down any loan the moment it happens — it keeps relationships good.\n• Spend time with family, a little less time on the phone.\n• Keep photos of important papers organised, and back up regularly.\n• A short daily walk and regular sleep keep body and mind well.\n\nFor advice from your own records, say: "how can I spend less?".';

/** আপন's answer about itself. */
export function aboutAponAnswer(topic: AboutTopic, bn: boolean): string {
  if (SYMPTOM_TOPICS.includes(topic)) return symptomAnswer(topic as SymptomTopic, bn);
  switch (topic) {
    case 'creator':
    case 'contact': return bn ? CREATOR_BN : CREATOR_EN;
    case 'purpose': return bn ? PURPOSE_BN : PURPOSE_EN;
    case 'privacy': return bn ? PRIVACY_BN : PRIVACY_EN;
    case 'manual': return manual(bn);
    case 'future': return bn ? FUTURE_BN : FUTURE_EN;
    case 'audience': return bn ? AUDIENCE_BN : AUDIENCE_EN;
    case 'benefits': return bn ? BENEFITS_BN : BENEFITS_EN;
    case 'healthTips': return bn ? HEALTH_BN : HEALTH_EN;
    case 'lifeTips': return bn ? LIFE_BN : LIFE_EN;
    case 'identity':
    default:
      return bn
        ? `আমি আপন — আপনার নিজের সহকারী। আপনার কাজ, দরকারি তথ্য, টাকা-পয়সা, দেনা-পাওনা আর ওষুধের হিসাব রাখি, সময়মতো মনে করিয়ে দিই — সব আপনার ফোনেই, ইন্টারনেট ছাড়াও। আমাকে তৈরি করেছেন SUMON, ডিজাইন করেছেন MD ABDUR RAHMAN FAHIM (ABO ENTERPRISE)।\n\nকী কী পারি দেখতে বলুন "তুমি কী কী পারো?", পুরো নির্দেশিকার জন্য "ব্যবহার নির্দেশিকা দাও"।`
        : `I’m Apon — your own assistant. I keep your tasks, notes, money, debts and medicines, and remind you on time — all on your phone, even without internet. I was made by SUMON and designed by MD ABDUR RAHMAN FAHIM (ABO ENTERPRISE).\n\nSay "help" to see what I can do, or "user guide" for the full guide.`;
  }
}
