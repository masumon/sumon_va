// Deterministic bilingual lexicon for the local NLP engine. No model, no network —
// just a hand-tuned Bengali + English vocabulary that the intent/entity extractors and
// the learning layer share. Keep entries lowercase and NFKC-normalized.

// ── Action verbs → this is a TASK ──────────────────────────────────────────────────────
// English: matched as a leading imperative ("call the bank ...").
export const EN_ACTION_VERBS = [
  'call', 'phone', 'ring', 'text', 'email', 'e-mail', 'mail', 'message', 'msg', 'dm', 'ping', 'reply', 'respond',
  'follow up', 'followup', 'check in', 'reach out', 'contact', 'ask', 'tell', 'remind',
  'buy', 'get', 'grab', 'pick up', 'pickup', 'collect', 'order', 'purchase', 'return', 'exchange', 'refund',
  'book', 'reserve', 'schedule', 'arrange', 'plan', 'organize', 'organise', 'set up', 'setup',
  'pay', 'renew', 'submit', 'file', 'send', 'deposit', 'withdraw', 'transfer', 'apply', 'register', 'sign', 'sign up',
  'finish', 'complete', 'start', 'begin', 'continue', 'prepare', 'prep', 'review', 'read', 'write', 'draft', 'edit',
  'update', 'fix', 'repair', 'clean', 'wash', 'cook', 'water', 'feed', 'walk', 'drop off', 'dropoff', 'deliver',
  'meet', 'visit', 'go to', 'attend', 'join', 'print', 'scan', 'download', 'upload', 'back up', 'backup',
  'charge', 'move', 'pack', 'unpack', 'confirm', 'cancel', 'reschedule', 'book a', 'take', 'bring', 'return the',
  'study', 'practice', 'practise', 'revise', 'memorize', 'learn', 'watch', 'listen',
];

// Bengali task verb endings ("… করতে হবে / … করব / … কিনব …"). Matched with a
// no-preceding/following-letter boundary in intent.ts.
export const BN_ACTION_STEMS = [
  'কর', 'যা', 'কিন', 'আন', 'নে', 'নি', 'দে', 'দি', 'লিখ', 'পাঠা', 'বানা', 'রাখ', 'ডাক', 'বল', 'আস', 'খা',
  'নামা', 'তুল', 'ধর', 'দেখ', 'শুন', 'শোন', 'পড়', 'জমা দে', 'কল দে', 'ফোন দে', 'যোগ দে', 'শুরু কর', 'নিয়ে যা',
  'পরিষ্কার কর', 'ধুয়ে ফেল', 'রান্না কর', 'গোছা', 'সারা', 'শেষ কর', 'কিনে আন', 'নিয়ে আয়', 'পাঠিয়ে দে',
];

// Bengali infinitive + obligation ("… করতে হবে / লাগবে / আছে").
export const BN_OBLIGATION_VERBS = [
  'করতে', 'যেতে', 'পাঠাতে', 'দেখতে', 'কিনতে', 'আনতে', 'নিতে', 'দিতে', 'বলতে', 'লিখতে', 'ধরতে', 'আসতে',
  'খেতে', 'জমা দিতে', 'কল দিতে', 'ফোন দিতে', 'যোগ দিতে', 'শুরু করতে', 'নিয়ে যেতে', 'পড়তে', 'শুনতে',
  'পরিষ্কার করতে', 'রান্না করতে', 'গোছাতে', 'সারতে', 'শেষ করতে', 'জমা করতে', 'পূরণ করতে', 'পরিশোধ করতে',
];

// ── Memory markers → this is a NOTE/FACT, not a task ────────────────────────────────────
export const MEMORY_MARKERS = [
  // English
  'remember', 'note', 'note down', 'jot down', 'save', 'keep', 'memorize', "don't forget that", 'for the record',
  'the password is', 'password:', 'wifi is', 'wifi password', 'account number', 'pin is', 'code is',
  'my ', 'his ', 'her ', 'their ', 'the ', 'address is', 'birthday is', 'anniversary is', 'is on', 'is at',
  // Bengali
  'মনে রাখ', 'মনে রাখো', 'মনে রাখবে', 'নোট কর', 'নোট করো', 'টুকে রাখ', 'লিখে রাখ', 'সেভ কর', 'মনে রাখার জন্য',
  'পাসওয়ার্ড', 'ঠিকানা', 'জন্মদিন', 'অ্যাকাউন্ট নম্বর', 'পিন', 'কোড', 'তথ্য', 'আমার ', 'তার ', 'ওর ',
];

// ── Priority / urgency keywords ────────────────────────────────────────────────────────
export const PRIORITY_KEYWORDS: Record<'URGENT' | 'HIGH' | 'LOW', string[]> = {
  URGENT: ['urgent', 'asap', 'immediately', 'right now', 'emergency', 'critical', '!!!', 'জরুরি', 'এখনই', 'তৎক্ষণাৎ', 'দ্রুত', 'তাড়াতাড়ি', 'অতি জরুরি'],
  HIGH: ['important', 'high priority', 'priority', 'must', 'don\'t forget', 'critical', '!!', 'গুরুত্বপূর্ণ', 'অবশ্যই', 'ভুলো না', 'ভুলবে না', 'মাস্ট'],
  LOW: ['whenever', 'someday', 'no rush', 'low priority', 'if possible', 'eventually', 'কোনো একদিন', 'সময় পেলে', 'তাড়া নেই', 'পরে হলেও'],
};

// ── Number words → digits (bare cardinals only; the "-টা" counter stays intact because
// the boundary check only looks at the *preceding* char, so "তিনটায়" → "3টায়"). ──────
export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
  'দুই': 2, 'দুটো': 2, 'দুটা': 2, 'তিন': 3, 'তিনটে': 3, 'চার': 4, 'পাঁচ': 5, 'ছয়': 6, 'সাত': 7,
  'আট': 8, 'নয়': 9, 'দশ': 10, 'এগারো': 11, 'বারো': 12,
};

// ── Relative-date words (isoDate offsets resolved in entities.ts) ──────────────────────
export const RELATIVE_DATE_WORDS: Record<string, number> = {
  today: 0, tonight: 0, tomorrow: 1, 'day after tomorrow': 2, 'next day': 1,
  'আজ': 0, 'আজকে': 0, 'আজকের': 0, 'আজ রাতে': 0, 'আগামীকাল': 1, 'কাল': 1, 'কালকে': 1, 'পরশু': 2, 'পরের দিন': 1,
};

// ── Common noun → tag hints (auto-tag suggestions) ────────────────────────────────────
export const TAG_HINTS: Record<string, string[]> = {
  work: ['office', 'meeting', 'report', 'boss', 'client', 'deadline', 'project', 'email', 'presentation', 'supplier', 'invoice', 'shop', 'অফিস', 'মিটিং', 'সভা', 'রিপোর্ট', 'বস', 'ক্লায়েন্ট', 'প্রজেক্ট', 'কাজের', 'দোকান', 'সাপ্লায়ার', 'ব্যবসা'],
  money: ['pay', 'bill', 'rent', 'bank', 'salary', 'wage', 'invoice', 'loan', 'emi', 'instalment', 'installment', 'tax', 'bkash', 'nagad', 'বিল', 'ভাড়া', 'ব্যাংক', 'বেতন', 'মজুরি', 'ঋণ', 'ধার', 'দেনা', 'পাওনা', 'কিস্তি', 'ট্যাক্স', 'বিকাশ', 'নগদ', 'টাকা', 'খরচ', 'আয়'],
  health: ['doctor', 'physician', 'medicine', 'medicines', 'pill', 'tablet', 'prescription', 'hospital', 'clinic', 'gym', 'workout', 'appointment', 'checkup', 'dentist', 'pharmacy', 'ডাক্তার', 'চিকিৎসক', 'ওষুধ', 'ঔষধ', 'মেডিসিন', 'ট্যাবলেট', 'প্রেসক্রিপশন', 'ব্যবস্থাপত্র', 'চিকিৎসা', 'হাসপাতাল', 'ক্লিনিক', 'ফার্মেসি', 'প্রেসার', 'ডায়াবেটিস', 'সুগার', 'টেস্ট', 'রিপোর্ট', 'জিম', 'ব্যায়াম', 'চেকআপ', 'ইনজেকশন', 'টিকা'],
  home: ['grocery', 'groceries', 'shopping', 'clean', 'laundry', 'cook', 'repair', 'gas', 'water', 'electricity', 'বাজার', 'কেনাকাটা', 'পরিষ্কার', 'কাপড়', 'রান্না', 'গ্যাস', 'বিদ্যুৎ', 'পানি', 'মেরামত', 'বাসা', 'বাড়ি'],
  family: ['mom', 'mother', 'dad', 'father', 'wife', 'husband', 'kids', 'son', 'daughter', 'parents', 'brother', 'sister', 'family', 'মা', 'আম্মা', 'বাবা', 'আব্বা', 'স্ত্রী', 'স্বামী', 'ছেলে', 'মেয়ে', 'বাচ্চা', 'ভাই', 'বোন', 'পরিবার', 'শ্বশুর', 'শাশুড়ি', 'নানা', 'নানি', 'দাদা', 'দাদি'],
  study: ['exam', 'class', 'assignment', 'homework', 'lecture', 'read', 'revise', 'school', 'college', 'university', 'tuition', 'পরীক্ষা', 'ক্লাস', 'অ্যাসাইনমেন্ট', 'পড়া', 'পড়াশোনা', 'লেকচার', 'স্কুল', 'কলেজ', 'বিশ্ববিদ্যালয়', 'টিউশন', 'হোমওয়ার্ক'],
};

// ── Multi-step separators ("A, then B, and C") ────────────────────────────────────────
// F-026: `\b` only recognizes ASCII word characters, so it never fires around Bengali
// script at all — "দুধ কেনো তারপর ব্যাংকে যাও" never split on "তারপর". The Bengali
// alternatives use the same letter/combining-mark boundary the rest of the NLP layer
// already relies on for this exact reason.
export const STEP_SEPARATORS = /\s*(?:,|;|।|\band then\b|\bthen\b|\bafter that\b|(?<![\p{L}\p{M}])(?:ও\s*তারপর|তারপর|এরপর|এবং|আর)(?![\p{L}\p{M}])|&)\s*/giu;

/** Levenshtein distance — used for light typo tolerance on verb/keyword matching. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** True if `word` fuzzily equals any candidate (exact, or edit-distance ≤1 for len≥5). */
export function fuzzyIncludes(word: string, candidates: readonly string[]): boolean {
  if (candidates.includes(word)) return true;
  if (word.length < 5) return false;
  return candidates.some((c) => c.length >= 5 && Math.abs(c.length - word.length) <= 1 && editDistance(word, c) <= 1);
}
