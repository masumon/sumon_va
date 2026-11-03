// "ওষুধ কিভাবে যোগ করব?", "ব্যাকআপ কোথায় নেব?", "how do I set a reminder?" — questions
// about the app itself. Answered from this fixed guide, never by the language model: the
// model does not know this app, and a made-up menu path sends a person looking for a button
// that is not there. Each answer names the screen, the button on it, and the one sentence
// that does the same thing from the Assistant, and the reply opens that screen.

import type { ScreenId } from './capabilities';

export type GuideTopic =
  | 'task' | 'memory' | 'money' | 'wallet' | 'debt' | 'medicine' | 'doctor' | 'backup'
  | 'restore' | 'lock' | 'screenshot' | 'ai' | 'theme' | 'attach' | 'reminder' | 'timezone'
  | 'export' | 'trash' | 'permission' | 'search' | 'focus' | 'calendar' | 'timeline' | 'parts' | 'checkup'
  | 'apon' | 'pageGuide' | 'photoText';

interface GuideEntry { words: RegExp; screen: ScreenId; bn: string; en: string }

// Order matters where words overlap: "ব্যাকআপ থেকে ফেরত" is restore before backup,
// "ওষুধের রিমাইন্ডার" is medicine before reminder.
const GUIDE: [GuideTopic, GuideEntry][] = [
  // 1.0: আপন floats over the main pages, every page has its own guide, and a photo's lines
  // can be picked. First, so "ছবি থেকে লেখা" is not answered as a plain photo attachment.
  ['apon', { words: /আপন\s*(?:বোতাম|বাটন|কোথায়|কোথায়)|ভাসমান|গোল\s*বোতাম|floating|apon button/iu, screen: 'home', bn: 'প্রধান পাতাগুলোর উপর ভাসমান গোল "আপন" বোতাম — ছুঁলেই আমাকে পাবেন। সরাতে চাইলে বোতামটা চেপে ধরে (একটু থেমে) টেনে যেখানে খুশি রাখুন; ছেড়ে দিলে পাশে বসে যায়, পরের বারও সেখানেই থাকে। লেখার সময় কিবোর্ড খুললে বোতামটা সরে থাকে।', en: 'The round floating "আপন" button sits over the main pages — tap it to reach me. To move it, press and hold, then drag it anywhere; let go and it settles on the side and stays there.' }],
  ['pageGuide', { words: /নির্দেশিকা\s*(?:আবার|কোথায়)|কীভাবে\s*ব্যবহার\s*করবেন|কিভাবে\s*ব্যবহার\s*করবেন|প্রতিটা?\s*পাতার?\s*(?:নির্দেশ|গাইড)|page guide/iu, screen: 'home', bn: 'প্রতিটা অংশের (পরিকল্পনা, মেমোরি, আয়-ব্যয়, দেনা-পাওনা, স্বাস্থ্য, আপন) শিরোনামের নিচে "কীভাবে ব্যবহার করবেন?" চাপুন — ধাপে ধাপে নির্দেশিকা আর উদাহরণ খুলবে; উদাহরণে চাপ দিলে আমার কাছে লেখা হয়ে আসে।', en: 'Under each part’s title (Planning, Memory, Money, Debts, Health, আপন) tap "How to use this?" — step-by-step help with examples; tap an example to bring it to me.' }],
  ['photoText', { words: /ছবি\s*থেকে\s*লেখা|লেখা\s*তুল|ছবির\s*লেখা|OCR|স্ক্যান|read text from (?:a )?photo|scan/iu, screen: 'home', bn: 'হোমের লেখার ঘরের পাশে 📷 চাপুন → "ছবি তুলুন" বা "গ্যালারি থেকে" → দুই লাইনের বেশি হলে "কোন লাইনগুলো রাখবেন?" আসে — যে লাইন লাগবে না তাতে চাপ দিয়ে বাদ দিন, তারপর "…টি লাইন বসান"; লেখা ছবির ক্রমেই বসে। অ্যাপের নিজের রিডার ইংরেজি ছাপা লেখা পড়ে; বাংলা পড়তে ছবি পড়তে পারে এমন AI মডেল লাগে।', en: 'Next to Home’s box tap 📷 → "Take a photo" or "From gallery" → for more than two lines you pick which lines to keep, then "Use … lines"; they arrive in the page’s order. The built-in reader reads printed English; Bangla needs an image-capable AI model.' }],
  ['trash', { words: /মুছে\s*ফেলা|ট্র্যাশ|ট্রাশ|ভুল\s*করে\s*মুছ|trash|deleted/iu, screen: 'trash', bn: 'নিচের "আরও" → "মুছে ফেলা জিনিস" — ভুল করে মোছা কাজ বা মেমোরি ৩০ দিনের মধ্যে ফেরত আনুন।', en: '"More" at the bottom → "Deleted items" — bring back a task or memory deleted by mistake within 30 days.' }],
  ['permission', { words: /অনুমতি|পারমিশন|permission/iu, screen: 'permissions', bn: 'নিচের "আরও" → "অনুমতি" — কোনটা কেন লাগে, আর আপনার ফোনের জন্য কী করতে হবে, সব লেখা আছে।', en: '"More" at the bottom → "Permissions" — why each is needed and what to do on your phone.' }],
  ['parts', { words: /অংশ\s*(?:চালু|বন্ধ|লুকা)|মডিউল|module/iu, screen: 'home', bn: 'নিচের "আরও" → "সেটিংস" → "অংশ চালু বা বন্ধ" — দেনা-পাওনা, আয়-ব্যয়, স্বাস্থ্য যা লাগে না লুকিয়ে রাখুন; কিছু মুছে যায় না।', en: '"More" at the bottom → "Settings" → "Turn parts on or off" — hide debts, money or health if you do not need them; nothing is deleted.' }],
  ['checkup', { words: /ডায়াগনস্টিক|পরীক্ষা\s*করে\s*দেখ|ঠিক\s*আছে\s*কি\s*না|checkup|diagnostic/iu, screen: 'diagnostics', bn: 'নিচের "আরও" → "অ্যাপ ঠিক আছে কি না" → "পরীক্ষা চালান"। এখানে লিখেও জানতে পারেন: "অ্যাপ ঠিক আছে তো?"', en: '"More" at the bottom → "Is the app all right" → run the check. Or ask here: "is the app working?"' }],
  ['focus', { words: /ফোকাস|টাইমার|focus|timer/iu, screen: 'focus', bn: 'নিচের "আরও" → "ফোকাস" → একটা কাজ বেছে ১৫/২৫/৫০ মিনিটের টাইমার চালু করুন।', en: '"More" at the bottom → "Focus" → pick a task and start a 15/25/50-minute timer.' }],
  ['calendar', { words: /ক্যালেন্ডার|calendar/iu, screen: 'calendar', bn: 'নিচের "আরও" → "ক্যালেন্ডার" — মাসের কোন দিনে কী আছে দেখুন।', en: '"More" at the bottom → "Calendar" — see what is on each day of the month.' }],
  ['timeline', { words: /যা\s*যা\s*ঘটেছে|টাইমলাইন|timeline/iu, screen: 'timeline', bn: 'নিচের "আরও" → "যা যা ঘটেছে" — টাকা, দেনা, স্বাস্থ্য কোন দিন কী হলো।', en: '"More" at the bottom → "What happened" — money, debts and health by day.' }],
  ['search', { words: /খোঁজ|খুঁজ|সার্চ|search/iu, screen: 'search', bn: 'হোমের উপরে 🔍 বা নিচের "আরও" → "সব জায়গায় খোঁজা"। এখানে লিখলেও খুঁজে দেব: "সব জায়গায় পাসপোর্ট খোঁজো"।', en: 'The 🔍 at the top of Home, or "More" at the bottom → "Search everything". Or ask here: "search everywhere for passport".' }],
  ['restore', { words: /রিস্টোর|ফেরত\s*আন|restore/iu, screen: 'backup', bn: 'নিচের "আরও" → "ব্যাকআপ ও ফেরত আনা" → "ব্যাকআপ থেকে ফেরত আনুন" → ফাইল বেছে নিন। তালাবদ্ধ হলে পাসওয়ার্ড চাইবে। এই ফোনের অ্যাপ লক ও AI মডেল যেমন আছে তেমনই থাকবে।', en: '"More" at the bottom → "Backup and restore" → "Restore" → pick the file. It asks for the password if locked. This phone’s app lock and AI model stay as they are.' }],
  ['export', { words: /এক্সেল|excel|এক্সপোর্ট|export|প্রিন্ট|print|স্প্রেডশিট|spreadsheet/iu, screen: 'backup', bn: 'নিচের "আরও" → "ব্যাকআপ ও ফেরত আনা" → "অন্য কোথাও দেখার জন্য কপি" — পড়ার মতো লেখা, এক্সেলের খাতা বা অন্য অ্যাপের জন্য ফাইল বেছে নিন। এটা ব্যাকআপ নয়।', en: '"More" at the bottom → "Backup and restore" → "A copy to read elsewhere" — pick easy-to-read text, a spreadsheet or a file for another app. It is not a backup.' }],
  ['backup', { words: /ব্যাকআপ|backup/iu, screen: 'backup', bn: 'নিচের "আরও" → "ব্যাকআপ ও ফেরত আনা" → "এখনই ব্যাকআপ নিন"। "সাপ্তাহিক অটো-ব্যাকআপ" কার্ডে অটো-ব্যাকআপ চালু করুন আর পাসওয়ার্ড দিয়ে তালা দিন। এখান থেকে লিখুন: "এখনই ব্যাকআপ নাও"।', en: '"More" at the bottom → "Backup and restore" → "Take a backup now". Turn on automatic backup and lock it with a password on the "Weekly automatic backup" card. Or type here: "back up now".' }],
  ['medicine', { words: /ওষুধ|ঔষধ|ট্যাবলেট|ডোজ|medicine|dose|pill/iu, screen: 'health', bn: 'স্বাস্থ্য → "ওষুধ" → নতুন যোগ করুন। খাওয়ার সময় দিলে ঠিক সময়ে মনে করিয়ে দেবে; খেয়ে ফেললে এখানে লিখুন "ওষুধ খেয়েছি"।', en: 'Health → "Medicines" → add one. Give the times and you are reminded; after taking it, type "I took my medicine" here.' }],
  ['doctor', { words: /ডাক্তার|টেস্ট|পরীক্ষা|প্রেসক্রিপশন|রিপোর্ট|doctor|test|prescription|report/iu, screen: 'health', bn: 'স্বাস্থ্য → "ডাক্তার", "পরীক্ষা" বা "প্রেসক্রিপশন" → নতুন যোগ করুন। রিপোর্টের ছবি বা PDF "ফাইল" দিয়ে যোগ করা যায়।', en: 'Health → "Doctor", "Tests" or "Prescriptions" → add. Attach a report photo or PDF with "File".' }],
  ['debt', { words: /দেনা|পাওনা|ধার|ঋণ|debt|loan|owe/iu, screen: 'debt', bn: 'হোম → "দেনা-পাওনা" → নতুন হিসাব। টাকা ফেরত দিলে বা পেলে সেই মানুষের হিসাবে লিখুন। এখান থেকে লিখুন: "করিম ভাই থেকে ৫০০০ টাকা ধার নিলাম"।', en: 'Home → "Debts" → new account. Record repayments under that person. Or type here: "borrowed 5000 from Karim".' }],
  ['wallet', { words: /মানিব্যাগ|ওয়ালেট|বিকাশ|নগদ|ব্যাংক\s*হিসাব|wallet/iu, screen: 'wallets', bn: 'আয়-ব্যয় → "মানিব্যাগ" → নগদ, বিকাশ, ব্যাংক — কোথায় কত আছে যোগ করুন।', en: 'Finance → "Wallets" → add cash, bKash, bank — where your money is.' }],
  ['money', { words: /খরচ|আয়|আয়|হিসাব|টাকা|বেতন|expense|income|spend/iu, screen: 'finance', bn: 'আয়-ব্যয় → "ব্যয় যোগ" বা "আয় যোগ"। এখান থেকে লিখুন: "বাজারে ৫০০ টাকা খরচ" বা "বেতন পেলাম ৩০০০০"।', en: 'Finance → "Add expense" or "Add income". Or type here: "spent 500 on groceries".' }],
  ['screenshot', { words: /স্ক্রিনশট|screenshot/iu, screen: 'settings', bn: 'নিচের "আরও" → সেটিংস → "গোপনীয়তা ও লক" → "স্ক্রিনশট আটকান" চালু বা বন্ধ করুন। অ্যাপ লক চালু থাকলে এটি সবসময় চালু থাকে।', en: 'Settings → "Privacy & lock" → turn "Block screenshots" on or off. It stays on while App Lock is on.' }],
  ['lock', { words: /লক|পিন|পাসওয়ার্ড|ফিঙ্গারপ্রিন্ট|lock|pin|fingerprint/iu, screen: 'settings', bn: 'নিচের "আরও" → সেটিংস → "গোপনীয়তা ও লক" → "অ্যাপ লক (পিন)" চালু করুন। অন্য অ্যাপ থেকে ফিরলে পিন বা ফিঙ্গারপ্রিন্ট চাইবে।', en: 'Settings → "Privacy & lock" → turn on "App lock (PIN)". It asks for the PIN or fingerprint when you come back.' }],
  ['ai', { words: /(?:এআই|ai)\s*(?:মডেল|model)?|মডেল|model/iu, screen: 'ai-model', bn: 'নিচের "আরও" → "নিজের AI মডেল" → ফোনে রাখা GGUF মডেল ফাইল বেছে নিন। ফোনের RAM কম হলে অ্যাপ জানিয়ে দেবে; AI ছাড়াও আপন চলে। AI ধীর হলে, ফোনের RAM কম পড়লে বা বন্ধ হয়ে গেলে সাথে সাথে হলুদ বার্তায় কারণ আর করণীয় জানাব — সাধারণত অন্য অ্যাপ (ফেসবুক, ইউটিউব, গেম) বন্ধ করলেই ঠিক হয়; বারবার হলে ছোট মডেল (১–২ GB-এর মতো) নিন। জিজ্ঞেস করুন: "AI ধীর কেন?"', en: '"More" at the bottom → "Your own AI model" → pick a GGUF model file on the phone. The app tells you if the phone lacks RAM; Apon works without it too. If the AI is slow, short of RAM or stops, a yellow message says why and what to do at once — usually closing other apps fixes it; if it keeps happening, pick a smaller model (around 1–2 GB). Ask: "why is the AI slow?"' }],
  ['theme', { words: /থিম|ডার্ক|লাইট|ভাষা|ফন্ট|theme|dark|light|language|font/iu, screen: 'settings', bn: 'নিচের "আরও" → সেটিংস → দেখতে কেমন: আলো/অন্ধকার থিম, ভাষা (বাংলা/English)।', en: 'Settings → appearance: light/dark theme, language (Bengali/English).' }],
  ['timezone', { words: /সময়\s*অঞ্চল|টাইম\s*জোন|time\s*zone/iu, screen: 'settings', bn: 'নিচের "আরও" → সেটিংস → সময় অঞ্চল — ঢাকা ছাড়া অন্য দেশে থাকলে বদলে নিন; সব রিমাইন্ডার সেই সময় ধরে চলবে।', en: 'Settings → time zone — change it if you live outside Dhaka; every reminder follows it.' }],
  ['attach', { words: /ছবি|ফাইল|PDF|সংযুক্ত|attach|photo|file/iu, screen: 'memory', bn: 'যেকোনো কাজ, মেমোরি, খরচ বা স্বাস্থ্যের রেকর্ড খুলে "যোগ করুন" → ক্যামেরা, গ্যালারি বা ফাইল। ছবি ছুঁলে বড় হয়, দুই আঙুলে zoom।', en: 'Open any task, memory, expense or health record → "Add" → camera, gallery or file. Tap a photo to view it; pinch to zoom.' }],
  ['reminder', { words: /রিমাইন্ডার|মনে\s*করিয়ে|নোটিফিকেশন|অ্যালার্ম|reminder|notification|alarm/iu, screen: 'planning', bn: 'পরিকল্পনা → "নতুন কাজ" → সময় দিন — ঠিক সময়ে মনে করিয়ে দেবে। এখান থেকে লিখুন: "কাল সকাল ৯টায় ব্যাংকে যাব"। রিমাইন্ডার না এলে: নিচের "আরও" → রিমাইন্ডার — সেখানে আপনার ফোনের জন্য ধাপ আছে; হোমের কমলা কার্ডও বলে দেয় কী বাকি।', en: 'Planning → "New task" → give a time and you are reminded. Or type here: "bank tomorrow at 9am". If reminders do not arrive, the Reminders page has steps for your phone.' }],
  ['task', { words: /কাজ|টাস্ক|প্ল্যান|পরিকল্পনা|task|plan|todo/iu, screen: 'planning', bn: 'পরিকল্পনা → উপরের "নতুন কাজ" → নাম ও সময় দিন। এখান থেকে লিখুন: "কাল বিকেল ৫টায় মিটিং"।', en: 'Planning → "New task" at the top → name and time. Or type here: "meeting tomorrow at 5pm".' }],
  ['memory', { words: /মেমোরি|মেমরি|নোট|মনে\s*রাখ|memory|note/iu, screen: 'memory', bn: 'মেমোরি → "+ যোগ" → লিখে সংরক্ষণ করুন। পরে এখানে জিজ্ঞেস করলেই পাবেন। এখান থেকে লিখুন: "মনে রাখো আমার পাসপোর্ট নম্বর …"।', en: 'Memories → "+ Add" → write and save; ask here later. Or type here: "remember my passport number …".' }],
];

const HOW = /(?:কিভাবে|কীভাবে|কেমনে|কেমন\s*করে|কোথায়|কোথায়|কোথা\s*থেকে|কোন\s*জায়গায়|কোন\s*জায়গায়|কোথায়\s*পাব|\bhow\s+(?:do|can|to|should)\b|\bwhere\s+(?:do|can|is|are)\b)/iu;
const APP_ACTION = /(?:যোগ|দেব|দিব|দিতে|দেওয়া|নেব|নিব|নিতে|নেওয়া|রাখব|রাখতে|চালু|বন্ধ|বদল|খুলব|খুলতে|দেখব|দেখতে|লিখব|লিখতে|ফেরত|সেট|পাব|ব্যবহার|সরা|তুল|খুল|\b(?:add|set|use|turn|open|change|see|find|make|take|record|attach|restore|lock)\b)/iu;

/** The app feature a "how do I / where do I" question is about, or null. */
export function guideTopicFor(text: string): GuideTopic | null {
  if (!HOW.test(text) || !APP_ACTION.test(text)) return null;
  return GUIDE.find(([, g]) => g.words.test(text))?.[0] ?? null;
}

export function guideAnswer(topic: GuideTopic, bn: boolean): { text: string; screen: ScreenId } {
  const entry = GUIDE.find(([t]) => t === topic)![1];
  return { text: bn ? entry.bn : entry.en, screen: entry.screen };
}
