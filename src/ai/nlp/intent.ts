import type { NlpIntent } from './types';
import { EN_ACTION_VERBS, fuzzyIncludes } from './lexicon';
import { mentionsSymptom } from '../health-advice';

interface IntentRule {
  intent: NlpIntent;
  patterns: RegExp[];
  confidence: number;
}

// Multi-word verbs need phrase matching; single words go through fuzzyIncludes for
// light typo tolerance ("submt the report" still → task).
const EN_MULTIWORD_VERBS = EN_ACTION_VERBS.filter((v) => v.includes(' '));
const EN_SINGLEWORD_VERBS = EN_ACTION_VERBS.filter((v) => !v.includes(' '));

// Bengali "word" boundary: exclude preceding/following letters *and* combining marks,
// otherwise "কাল" wrongly matches inside "বিকাল"/"সকাল" and verb endings mis-fire.
const BN_TASK_VERBS =
  /(?<![\p{L}\p{M}])(?:কর(?:ব|বো)|যাব(?:ো)?|কিনব(?:ো)?|আনব(?:ো)?|নেব(?:ো)?|নিব|দেব(?:ো)?|দিব|লিখব(?:ো)?|পাঠাব(?:ো)?|বানাব(?:ো)?|রাখব(?:ো)?|ডাকব|বলব|আসব|খাব|নামাব|তুলব|ধরব)(?![\p{L}\p{M}])/u;

// The same task-obligation verbs, romanized (Banglish) — a Bengali speaker typing in
// Latin script because there is no Bengali keyboard on hand, not a different language
// (F-012: "ami kalke bazar korbo 300 taka" was falling through to UNKNOWN entirely).
// Latin script has real word boundaries, so plain \b is enough here.
const BANGLISH_TASK_VERBS = /\b(?:korbo|korte hobe|korte hbe|jabo|kinbo|debo|dibo|nebo|nibo|lagbe|hobe|banabo|likhbo)\b/iu;

// English plain-imperative task capture. Real users type "call the supplier tomorrow
// at 9am" or "pick up medicine", not "create a task to …". Match a leading action verb
// (optionally after a soft intro like "i need to" / "don't forget to"), or an explicit
// "remind me to". Kept below the explicit rules so "search"/"remember" still win.
const EN_TASK_INTRO =
  /^(?:i\s+(?:need|have|want|got)\s+to|i\s+must|don'?t\s+forget\s+to|make\s+sure\s+to|remember\s+to|remind\s+me\s+to|need\s+to|have\s+to|please\s+)+/u;
function isEnglishImperativeTask(text: string): boolean {
  const stripped = text.replace(EN_TASK_INTRO, '').trimStart();
  if (EN_TASK_INTRO.test(text) && stripped.length > 0) return true;
  if (EN_MULTIWORD_VERBS.some((v) => stripped.startsWith(v + ' ') || stripped === v)) return true;
  const first = stripped.split(/[\s,]/u)[0] ?? '';
  return first.length > 1 && fuzzyIncludes(first, EN_SINGLEWORD_VERBS);
}

// Interrogative markers (bilingual). A trailing "?" alone is enough. Bengali markers
// use a letter/combining-mark boundary so "কে" does not fire inside "…কে" (an object
// marker) and "কী" is not caught inside a longer word.
const QUESTION_MARKERS =
  /(?<![\p{L}\p{M}])(?:কত|কতো|কবে|কখন|কোথায়|কোনখানে|কয়|কয়টা|কতটা|কতগুলো|কোনটা|কেন|কী)(?![\p{L}\p{M}])|(?<![\p{L}\p{M}])(?:কে|কাকে|কার)\s|\b(?:what|whats|what's|when|where|who|whom|whose|which|why|how\s+(?:many|much|old|long|far|often))\b|[?？]\s*$/u;

// Phrasings that are commands even when they contain an interrogative word.
const NOT_A_QUESTION =
  /(?:করতে|কিনতে|যেতে|আনতে|নিতে|দিতে|পাঠাতে|লিখতে|জমা\s*দিতে)\s*(?:হবে|লাগবে)|(?<![\p{L}\p{M}])(?:মনে\s*রাখ|টুকে\s*রাখ|সেভ\s*কর|লিখে\s*রাখ|নোট\s*কর)|\b(?:add|create|remind\s+me\s+to|remember|save|note\s+down|make\s+a\s+task)\b/u;

function looksLikeQuestion(text: string): boolean {
  return QUESTION_MARKERS.test(text) && !NOT_A_QUESTION.test(text);
}

const RULES: IntentRule[] = [
  {
    intent: 'HELP',
    confidence: 0.9,
    patterns: [
      /\b(help me|what can you do|what do you do|how (do|can) i use|how to use|your (features|capabilities)|show (me )?(help|guide)|list (your )?(features|commands))\b/u,
      /^help\s*$/u,
      /(সাহায্য|হেল্প|কী কী (করতে )?পার(ো|েন)?|কি কি (করতে )?পার(ো|েন)?|কীভাবে ব্যবহার|কিভাবে ব্যবহার|তুমি কী কর(তে পার)?|তুমি কি কর(তে পার)?|গাইড|নির্দেশনা|ফিচার(গুলো)? (কী|কি|দেখাও)|কী কী করা যায়|অ্যাপ(টা|টি)? (কী|কি) (কাজ কর|করে)|সব ফিচার)/u,
    ],
  },
  {
    intent: 'SMALL_TALK',
    confidence: 0.88,
    patterns: [
      /^(hi|hii+|hey|hello|helloo+|yo|salam|assalam(u)? ?alaikum|good (morning|afternoon|evening|night)|thanks|thank you|thx|ty|ok(ay)?|cool|nice|great)\b[\s!.]*$/u,
      /\b(how are you|who are you|what('| i)s your name|are you (a )?(bot|ai|robot)|tumi ke)\b/u,
      /^(হ্যালো|হাই+|হেই|আসসালামু ?আলাইকুম|সালাম|আদাব|শুভ (সকাল|দুপুর|বিকাল|সন্ধ্যা|রাত্রি|রাত)|ধন্যবাদ|থ্যাংক(স| ইউ)|থ্যাঙ্কস|ঠিক আছে|আচ্ছা|ওকে|বাহ|দারুণ|চমৎকার)[\s!।.]*$/u,
      /(কেমন আছ(ো|েন)?|তুমি কে|তোমার নাম কি|তোমার নাম কী|তুমি কি (রোবট|বট|এআই| ?ai))/u,
    ],
  },
  {
    intent: 'COMPLETE_TASK',
    confidence: 0.96,
    patterns: [
      /^(done|complete|finish|mark .* complete)\b/u,
      /\bdone\b/u,
      // "বাজার করা শেষ" — "<errand> করা শেষ".
      /[\p{L}\p{M}]+\s+করা\s+শেষ[\s।.!]*$/u,
      /শেষ (?:কর(?:ো|তে(?! হবে)|ে ফেল|েছি|ে দিয়েছি)|হয়ে গে)/u,
      /সম্পন্ন (?:কর(?:ো|তে(?! হবে)|েছি|ে ফেলেছি)|হয়ে গেছে|হয়েছে)/u,
      /হয়ে গেছে/u,
      /শেষ হয়েছে/u,
      // "রিপোর্টের কাজ শেষ" — a bare "শেষ" closing a sentence about a task.
      /(?:কাজ|কাজটা|কাজটি|টাস্ক)\S*\s+শেষ[\s।.!]*$/u,
      // "গাড়ি ধোয়া শেষ" — any errand closed with a bare "শেষ" (rc.13 QA H05). Not money or
      // a period running out ("টাকা শেষ", "মাস শেষ"), and never a question.
      /^(?![^?？]*(?:টাকা|মাস|বছর|সপ্তাহ|দিন)\s+শেষ)[^?？০-৯\d]{2,}?\s+শেষ[\s।.!]*$/u,
      /কমপ্লিট(?!\s*(?:কর(?:তে|ব|বো)|হবে))/u,
      /কম্পলিট(?!\s*(?:কর(?:তে|ব|বো)|হবে))/u,
      /সেরে ফেলেছি/u,
      /করে ফেলেছি/u,
    ],
  },
  {
    intent: 'RESCHEDULE_TASK',
    confidence: 0.95,
    patterns: [
      /\b(reschedule|postpone|delay)\b/u,
      /পিছিয়ে/u,
      /এগিয়ে (?:দা|আন|নি)/u,
      /সরিয়ে (?:দা|নি)/u,
      /তারিখ (?:বদল|পরিবর্তন|পাল্টা)/u,
      /অন্য দিন(?:ে)? কর/u,
      /পরে কর(?:ে দাও|ব|তে হবে)/u,
    ],
  },
  {
    intent: 'SEARCH_MEMORY',
    confidence: 0.94,
    patterns: [
      /\b(search|find|recall|look up)\b/u,
      /খুঁজ(?:ে|ে দাও|ে দেখ|ে বের)/u,
      /মনে কর(?:িয়ে|ে) দাও/u,
      /মনে আছে/u,
      /কোথায় (?:আছে|রেখেছি|লিখেছি)/u,
      /কী (?:ছিল|লিখেছিলাম)/u,
      // "show all my memories / notes", "list my notes"
      /\b(?:list|show|see|view|open)\s+(?:all\s+)?(?:my\s+)?(?:memor(?:y|ies)|notes?|saved)\b/u,
      /(?:সব|সকল|সমস্ত)\s*(?:আমার\s*)?(?:মেমোরি|মেমরি|নোট)(?:গুলো|স)?/u,
      /(?:আমার\s+)?(?:মেমোরি|মেমরি|নোট)(?:গুলো|স)?\s*(?:দেখা(?:ও|তে চাই)?|তালিকা)/u,
    ],
  },
  {
    intent: 'CREATE_MEMORY',
    confidence: 0.93,
    patterns: [
      /\b(remember|save|memorize|note down)\b/u,
      /মনে রাখ(?:ো|বে|বেন|তে)/u,
      /নোট (?:কর(?:ো)?|ে রাখ)/u,
      /মনে রাখার জন্য/u,
      /টুকে রাখ/u,
      /সেভ কর/u,
      /লিখে রাখ/u,
    ],
  },
  {
    intent: 'LIST_TASKS',
    confidence: 0.92,
    patterns: [
      /\b(list tasks|show tasks|what are my tasks|today'?s tasks|my tasks)\b/u,
      /কাজগুলো? দেখ/u,
      /কাজের তালিকা/u,
      /আজকের কাজ(?:গুলো)? (?:দেখ|কি|কী)/u,
      /কি কি কাজ (?:আছে|বাকি)/u,
      /(?:সব|আজকের)\s*কাজ(?:গুলো)?\s*(?:দেখাও|দেখান)/u,
    ],
  },
  {
    // Money moving between the speaker and a named person — borrowing or lending — not a
    // purchase. Ranked above RECORD_EXPENSE deliberately: "রহিমকে ২০০০ টাকা দিলাম" carries
    // the exact verb ("দিলাম") RECORD_EXPENSE's own pattern matches on, and filing a hand
    // loan as a plain expense loses the fact that it is owed back at all (F-011).
    intent: 'CREATE_DEBT',
    confidence: 0.95,
    patterns: [
      /(?<![\p{L}\p{M}])(?:ধার|লোন|ঋণ)\s*(?:নিলাম|নিয়েছি|করলাম|নিলেন|নিয়েছেন|নিছি|দিলাম|দিয়েছি|দিলেন|দিয়েছেন)(?![\p{L}\p{M}])/u,
      /\b(?:borrowed|took a loan|took out a loan|lent|loaned)\b/u,
      // The bare dative shape with no ধার/ঋণ word: "<name>কে <sum> টাকা দিলাম".
      /(?<![\p{L}\p{M}])(?!আমাকে|আমাদেরকে|তোমাকে|তোমাদেরকে|আপনাকে|আপনাদেরকে|ওকে|তাকে|তাদেরকে|কাকে|নিজেকে|সবাইকে)[^\s,।]+কে\s+.{0,20}?(?:টাকা|৳)\s*.{0,10}?(?:দিলাম|দিয়েছি|দিলেন|দিয়েছেন)(?![\p{L}\p{M}])/u,
    ],
  },
  {
    // Writing down money that has already moved — not a task, not a note.
    //
    // Ranked above CREATE_TASK deliberately: "৫০০ টাকা বাজারে খরচ করেছি" carries a verb
    // the task rules also claim, and filing a spent five hundred as a thing still to do
    // is the more damaging of the two mistakes.
    //
    // A sum is required by the pattern itself. "খরচ বেশি হচ্ছে" is a remark, not a record,
    // and an assistant that turns remarks into ledger entries is one nobody can trust with
    // a ledger.
    intent: 'RECORD_EXPENSE',
    confidence: 0.95,
    patterns: [
      // "৫০০ টাকা খরচ", "500 taka spent", "৳৫০০ দিলাম", with the sum before the verb
      /[০-৯\d][০-৯\d,.]*\s*(?:টাকা|৳|tk|taka)?\s*(?:.{0,24}?)(?:খরচ|ব্যয়|দিলাম|দিয়েছি|লাগল|লেগেছে|spent|paid)/u,
      // …or after it: "খরচ হয়েছে ৫০০ টাকা", "spent 500"
      /(?:খরচ|ব্যয়|spent|paid)\s*(?:.{0,24}?)[০-৯\d][০-৯\d,.]*\s*(?:টাকা|৳|tk|taka)?/u,
      // and the explicit forms: "৫০০ টাকা আয় হয়েছে", "income 5000"
      /[০-৯\d][০-৯\d,.]*\s*(?:টাকা|৳|tk|taka)?\s*(?:.{0,16}?)(?:আয়|পেয়েছি|পেলাম|income|earned|received)/u,
    ],
  },
  {
    intent: 'CREATE_TASK',
    confidence: 0.91,
    patterns: [
      /\b(add|create|make) (?:a )?(?:task|todo|reminder)\b/u,
      /\bremind me to\b/u,
      /\btodo\b/u,
      /কাজ যোগ/u,
      /(?:করতে|যেতে|পাঠাতে|দেখতে|কিনতে|আনতে|নিতে|দিতে|বলতে|লিখতে|ধরতে|আসতে|খেতে|জমা দিতে|কল দিতে|ফোন দিতে|যোগ দিতে|শুরু করতে|নিয়ে যেতে) (?:হবে|লাগবে|আছে)/u,
      /(?:কিনতে|আনতে|করতে|যেতে|দিতে|নিতে|খেতে|আসতে) লাগবে/u,
      BN_TASK_VERBS,
      BANGLISH_TASK_VERBS,
      /কাজ(?:টা|টি)(?![\p{L}\p{M}])/u,
      /আমাকে মনে করিয়ে দিও/u,
    ],
  },
];

// Checked before the ordered rules because each must beat a rule that sits above it.
//
// Asking for an analysis is never a ledger write — "গত তিন মাসের খরচ বিশ্লেষণ করো" once
// became a 3-taka expense.
const ANALYSIS_REQUEST = /(?:বিশ্লেষণ|বিশ্লেষন|কমানো যায়|কমানোর উপা(?:য়|য়)|কমাতে পারি|কীভাবে কমা|কিভাবে কমা|কমাব(?:ো)?\s*(?:কীভাবে|কিভাবে|কেমনে)|টাকা\s*জমাব(?:ো)?\s*(?:কীভাবে|কিভাবে)|কোথায় বেশি|পরামর্শ|\banaly[sz]|\bhow (?:can|do|could) i (?:save|reduce|cut)\b)/u;
// A sum in currency next to a ledger word is money that moved — above CREATE_MEMORY
// ("…খরচে লিখে রাখো") and COMPLETE_TASK ("খরচ হয়ে গেছে") which otherwise claim it.
const SUM_IN_CURRENCY = /[০-৯\d][০-৯\d,.]*\s*(?:টাকা|৳|tk\b|taka\b)/u;
// Spoken money verbs too: "মোবাইলে ২০০ টাকা রিচার্জ করলাম", "…খরচ হইছে", "…কিনলাম".
const LEDGER_WORD = /(?:খরচ|ব্যয়|আয়|বেতন|ভাড়া|বিল(?![\p{L}\p{M}])|গেছে|গেল(?![\p{L}\p{M}])|রিচার্জ|করলাম|কিনলাম|কিনেছি|হইছে|পাইছি|পেলাম|পেয়েছি|(?:ওটা|এটা|সেটা|আগেরটা|একইটা)\S*\s.*(?:যোগ|লিখ))/u;
const ASKS_HOW_MUCH = /(?<![\p{L}\p{M}])(?:কত|কতো)(?![\p{L}\p{M}])|[?？]\s*$/u;
// A reminder request with a thing to do — not a request to recall a saved fact. "পাসপোর্ট
// নম্বর মনে করিয়ে দাও" stays a lookup; "ওষুধ কিনতে মনে করিয়ে দিও" and "…reminder দাও" do not.
// Includes the everyday forms "দিবা", "দিবেন", "দিয়েন", "দিস".
const REMINDER_REQUEST = /(?:মনে\s*করিয়ে\s*(?:দিও|দিয়ো|দিবে|দেবে|দিবা|দিবেন|দিয়েন|দিস)|(?:তে|ার\s+কথা)\s+মনে\s*করিয়ে\s*(?:দাও|দিন)|(?:reminder|রিমাইন্ডার|অ্যালার্ম|এলার্ম|alarm)\s*(?:দাও|দিও|দিন|দিবে|দেবে|সেট|রাখ)|\bremind me\b|\bset (?:a |an )?(?:reminder|alarm)\b)/u;

const BN_ERRAND_IMPERATIVE = /^[^?？]{2,}?(?<![\p{L}\p{M}])(?:কেনো|কিনো|কিনে\s*আনো|আনো|নিয়ে\s*আসো|পাঠাও|বানাও|ধুয়ে\s*দাও|পরিষ্কার\s*করো|ফোন\s*(?:করো|দাও|দিও|দিয়ো)|জমা\s*দাও|দিয়ে\s*আসো|যাও|করে\s*আসো)[\s।.!]*$/u;

export function classifyIntent(text: string): { intent: NlpIntent; confidence: number } {
  const normalized = text.trim().toLocaleLowerCase();

  if (ANALYSIS_REQUEST.test(normalized)) {
    // About money → the spending analysis; about anything else → an ordinary question.
    return /(?:খরচ|টাকা|আয়|ব্যয়|বাজেট|spend|expense|money|budget)/u.test(normalized)
      ? { intent: 'ANALYZE_SPENDING', confidence: 0.9 }
      : { intent: 'ANSWER_QUESTION', confidence: 0.7 };
  }
  const debtRule = RULES.find((r) => r.intent === 'CREATE_DEBT')!;
  if (SUM_IN_CURRENCY.test(normalized) && LEDGER_WORD.test(normalized)
    && !ASKS_HOW_MUCH.test(normalized) && !debtRule.patterns.some((p) => p.test(normalized))) {
    return { intent: 'RECORD_EXPENSE', confidence: 0.95 };
  }
  if (REMINDER_REQUEST.test(normalized)) return { intent: 'CREATE_TASK', confidence: 0.93 };
  // A symptom asked about is a health question, never a task (rc.13 H06, beta audit C8):
  // "জ্বর হলে কোন ওষুধটা খাওয়া ভালো?" carries task verbs the rules below would claim.
  if (mentionsSymptom(normalized) && QUESTION_MARKERS.test(normalized)) return { intent: 'ANSWER_QUESTION', confidence: 0.8 };

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return { intent: rule.intent, confidence: rule.confidence };
    }
  }

  // A question the assistant should answer from stored memories/tasks. Checked after
  // the explicit action rules so "…খুঁজে দাও" still routes to SEARCH_MEMORY.
  if (looksLikeQuestion(normalized)) {
    return { intent: 'ANSWER_QUESTION', confidence: 0.8 };
  }

  // Banglish questions typed in Latin letters: "wifi password ki", "bill koto".
  if (/(?:^|\s)(?:ki|koto|kobe|kothay|keno|kivabe|kokhon)\s*\??\s*$/iu.test(normalized)) {
    return { intent: 'ANSWER_QUESTION', confidence: 0.7 };
  }

  // Fallback: a plain English imperative ("call the supplier tomorrow at 9am").
  if (isEnglishImperativeTask(normalized)) {
    return { intent: 'CREATE_TASK', confidence: 0.82 };
  }

  // The Bengali equivalent: a sentence that ends in an errand verb — "দুধ কেনো", "বিল জমা
  // দাও", "মাকে ফোন করো". MEDIUM confidence: the preview shows it and waits for confirm.
  if (BN_ERRAND_IMPERATIVE.test(normalized)) {
    return { intent: 'CREATE_TASK', confidence: 0.8 };
  }

  // "বেতন পাইছি ৩০০০০" — pay received, said without the word "টাকা".
  if (/[০-৯\d]{2,}/u.test(normalized) && /(?:বেতন|মাইনে|আয়)/u.test(normalized) && /(?:পাইছি|পেলাম|পেয়েছি|পাইলাম|এসেছে|আসছে)/u.test(normalized)) {
    return { intent: 'RECORD_EXPENSE', confidence: 0.85 };
  }

  // "রিকশায় ৬০ টাকা" — a sum said on its own, with no one owed and nothing earned, is a
  // spend. MEDIUM confidence: the card shows "খরচ: ৳৬০" before anything is written.
  if (/[০-৯\d][০-৯\d,.]*\s*(?:টাকা|৳|tk\b|taka\b)/u.test(normalized) && !looksLikeQuestion(normalized)
    && !/(?:কাছে|থেকে|ধার|পাওনা|পাব|পাবো|পাই|ফেরত|আয়|আয়|বেতন|দিলাম|দিয়েছি)/u.test(normalized)) {
    return { intent: 'RECORD_EXPENSE', confidence: 0.7 };
  }
  // "রিকশা ভাড়া ৫০", "ওষুধ কিনলাম ২৫০" — a sum beside a spending word, said without "টাকা"
  // (rc.13 #10). MEDIUM confidence: the card shows "খরচ: ৳৫০" before anything is written.
  if (/[০-৯\d]{2,}/u.test(normalized) && !looksLikeQuestion(normalized)
    && /(?:ভাড়া|ভাড়া|কিনলাম|কিনেছি|বিল(?![\p{L}\p{M}])|রিচার্জ|খরচ|দিলাম|দিয়েছি)/u.test(normalized)
    && !/(?:কাছে|থেকে|ধার|পাওনা|পাব|পাবো|ফেরত|আয়|আয়|বেতন|টায়|টায়|আগামীকাল|পরশু|আগামী)/u.test(normalized)) {
    return { intent: 'RECORD_EXPENSE', confidence: 0.7 };
  }
  // "tomorrow morning gym", "আগামী সপ্তাহে বিল" — a future day and a thing, with no verb.
  if (!looksLikeQuestion(normalized) && (/(?<![\p{L}\p{M}])(?:আগামীকাল|কাল|পরশু|আগামী|সামনের)(?![\p{L}\p{M}])|[০-৯\d]+\s*দিন\s*(?:পরে|পর)/u.test(normalized)
    || /\b(?:tomorrow|tonight|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/iu.test(normalized))) {
    return { intent: 'CREATE_TASK', confidence: 0.7 };
  }

  // A sentence carrying a clock time is almost always something to do at that time —
  // "আজ বিকেল ৫টায় মিটিং আছে", "প্রতিদিন সকাল ৮টায় প্রেসারের ওষুধ", "kal sokal 9 tay
  // doctor". MEDIUM confidence: the confirm card shows it before anything is saved.
  if (/[০-৯\d]{1,2}\s*(?:টায়|টায়|টা(?![\p{L}\p{M}])|:[০-৯\d]{2})|[০-৯\d]{1,2}\s*(?:am|pm|tay|ta)(?![a-z])/iu.test(normalized)) {
    return { intent: 'CREATE_TASK', confidence: 0.75 };
  }

  return { intent: 'UNKNOWN', confidence: 0 };
}
