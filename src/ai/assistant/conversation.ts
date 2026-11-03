import { normalizeText } from '../nlp/normalize';
import { aboutAponAnswer } from '../about-apon';

// Deterministic conversational replies — greetings, thanks, "who are you", and a full
// tour of what the app can do. No model: hand-written bilingual copy so the assistant
// never leaves the user with a blank "I don't understand".

export type Lang = 'bn' | 'en';

export interface HelpTopic {
  title: string;
  detail: string;
  /** A ready-to-run example the UI can offer as a tap chip. */
  example?: string;
}

export function helpTopics(lang: Lang): { intro: string; topics: HelpTopic[]; outro: string } {
  if (lang === 'bn') {
    return {
      intro: 'আমি এই ফোনেই কাজ করি — কোনো ইন্টারনেট বা ক্লাউড লাগে না। যা যা করতে পারি:',
      topics: [
        { title: 'টাস্ক তৈরি', detail: 'একটা লাইনে বললেই টাস্ক বানাই — সময়/তারিখসহ।', example: 'আগামীকাল সকাল ৯টায় ডাক্তারকে ফোন করতে হবে' },
        { title: 'টাস্ক শেষ / সময় পরিবর্তন', detail: '“কাজটা শেষ” বা “মিটিং পিছিয়ে দাও শুক্রবার” বললেই হয়।', example: 'রিপোর্টের কাজ শেষ' },
        { title: 'টাস্ক দেখা', detail: 'আপনার আজকের বা সব টাস্কের তালিকা দেখাই।', example: 'আমার কাজগুলো দেখাও' },
        { title: 'তথ্য মনে রাখা', detail: 'যেকোনো তথ্য — পাসওয়ার্ড, নম্বর, মেয়াদ — বললে সেভ করি।', example: 'মনে রাখো আমার পাসপোর্টের মেয়াদ ২০৩০ সাল' },
        { title: 'প্রশ্নের উত্তর', detail: 'সেভ করা তথ্য থেকে সরাসরি উত্তর দিই।', example: 'আমার পাসপোর্টের মেয়াদ কত?' },
        { title: 'মেমোরি খোঁজা', detail: 'পুরনো নোট বা তথ্য খুঁজে বের করি।', example: 'রিপোর্ট খুঁজে দাও' },
        { title: 'একসাথে কয়েকটি কাজ', detail: '“A কর, তারপর B” বললে ধাপে ধাপে সব করি।', example: 'দুধ কেনো, আর ব্যাংকে যেতে হবে' },
        { title: 'আজকের পরিকল্পনা', detail: 'আজ কী কী করতে হবে, কোনটা পিছিয়ে আছে, ইনবক্সে কী পড়ে আছে।', example: 'আজ কী কী করতে হবে?' },
        { title: 'আয়-ব্যয়', detail: 'খরচ বা আয় লিখি, হাতে কত টাকা আছে বলি।', example: 'বাজারে ৫০০ টাকা খরচ' },
        { title: 'দেনা-পাওনা', detail: 'ধার দেওয়া-নেওয়া লিখি; কার কাছে কত পাবেন বা দেবেন বলি।', example: 'আমার মোট দেনা কত?' },
        { title: 'স্বাস্থ্য', detail: 'পরের ওষুধ কখন, কোন ডোজ বাদ গেছে, ডাক্তার/টেস্ট কবে; "ওষুধ খেয়েছি" বললে লিখে রাখি।', example: 'পরের ওষুধ কখন?' },
        { title: 'খরচ বিশ্লেষণ', detail: 'কোথায় বেশি খরচ হচ্ছে, কীভাবে কমানো যায় — আপনার হিসাব থেকেই।', example: 'গত ৩ মাসের খরচ বিশ্লেষণ করো' },
        { title: 'সব জায়গায় খোঁজা', detail: 'কাজ, মেমোরি, হিসাব, মানুষ, স্বাস্থ্য — একসাথে।', example: 'সব জায়গায় পাসপোর্ট খোঁজো' },
        { title: 'অ্যাপ ও ব্যাকআপ', detail: 'অ্যাপ ঠিক আছে কি না, রিমাইন্ডার চালু কি না, শেষ ব্যাকআপ কবে; বললে এখনই ব্যাকআপ নিই।', example: 'অ্যাপ ঠিক আছে তো?' },
        { title: 'যেকোনো পাতা খোলা', detail: '"সেটিংস খোলো", "ব্যাকআপ পাতায় যাও" — সেটিংস বদলানো, রিস্টোর বা মুছে ফেলা আপনি নিজে করবেন, আমি শুধু পাতা খুলে দিই।', example: 'সেটিংস খোলো' },
        { title: 'সাধারণ প্রশ্ন', detail: 'AI চালু থাকলে সাধারণ প্রশ্নেরও উত্তর দিই — সেটা "সাধারণ জ্ঞান থেকে" বলে লেখা থাকে।' },
        { title: 'ভয়েস', detail: 'মাইক চেপে কথা বললেই লিখে নিই — অফলাইনে।' },
      ],
      outro: 'বাংলা বা ইংরেজি — যেভাবে খুশি বলুন। বুঝতে না পারলে আমি জানিয়ে দেব, আটকে থাকব না। পুরো ব্যবহার নির্দেশিকা চাইলে বলুন "ব্যবহার নির্দেশিকা দাও"; আমাকে কে বানিয়েছে জানতে "তোমাকে কে বানিয়েছে?"',
    };
  }
  return {
    intro: 'I run entirely on this device — no internet, no cloud. Here is what I can do:',
    topics: [
      { title: 'Create tasks', detail: 'Say it in one line and I make a task, with date/time.', example: 'call the doctor tomorrow at 9am' },
      { title: 'Complete / reschedule', detail: '“done with the report” or “move the meeting to Friday”.', example: 'done with the report' },
      { title: 'See tasks', detail: 'I list today’s or all of your tasks.', example: 'show my tasks' },
      { title: 'Remember info', detail: 'Passwords, numbers, expiry dates — tell me and I save it.', example: 'remember my passport expires in 2030' },
      { title: 'Answer questions', detail: 'I answer straight from what you saved.', example: 'when does my passport expire?' },
      { title: 'Search memory', detail: 'I find old notes and facts.', example: 'find the report' },
      { title: 'Multi-step', detail: '“do A, then B” and I run every step in order.', example: 'buy milk and go to the bank' },
      { title: 'Today’s plan', detail: 'What to do today, what is overdue, what is waiting in the inbox.', example: 'What should I do today?' },
      { title: 'Money', detail: 'I record spending or income and tell you what is on hand.', example: 'How much money do I have?' },
      { title: 'Debts', detail: 'Lending and borrowing, and who owes whom how much.', example: 'How much do I owe?' },
      { title: 'Health', detail: 'Next dose, missed doses, upcoming doctor or tests; "I took my medicine" marks it.', example: 'When is my next dose?' },
      { title: 'Spending analysis', detail: 'Where the money goes and how to spend less — from your own records.', example: 'Analyse my spending for 3 months' },
      { title: 'Search everything', detail: 'Tasks, memories, money, people and health at once.', example: 'Search everywhere for passport' },
      { title: 'App & backup', detail: 'Is the app healthy, are reminders on, when was the last backup; I can back up now.', example: 'Is the app working?' },
      { title: 'Open any screen', detail: '"Open settings" — settings, restore and deleting are done by you; I only open the screen.', example: 'Open settings' },
      { title: 'General questions', detail: 'With the AI on I answer general questions too, marked as general knowledge.' },
      { title: 'Voice', detail: 'Hold the mic and speak — transcribed offline.' },
    ],
    outro: 'Bangla or English, phrase it however you like. If I can’t work something out I’ll say so — I won’t get stuck. For the full guide say "user guide"; to know who made me, "who made you?"',
  };
}

export type SmallTalkKind = 'greeting' | 'thanks' | 'identity' | 'wellbeing' | 'ack';

export function classifySmallTalk(text: string): SmallTalkKind {
  const t = normalizeText(text);
  if (/(thank|thx|ধন্যবাদ|থ্যাংক|থ্যাঙ্ক)/u.test(t)) return 'thanks';
  if (/(who are you|your name|are you (a )?(bot|ai|robot)|তুমি কে|তোমার নাম|তুমি কি (রোবট|বট|এআই))/u.test(t)) return 'identity';
  if (/(how are you|কেমন আছ)/u.test(t)) return 'wellbeing';
  if (/^(ok(ay)?|cool|nice|great|ঠিক আছে|আচ্ছা|ওকে|বাহ|দারুণ|চমৎকার)/u.test(t)) return 'ack';
  return 'greeting';
}

export function smallTalkReply(text: string, lang: Lang): string {
  const kind = classifySmallTalk(text);
  const bn = lang === 'bn';
  switch (kind) {
    case 'thanks':
      return bn ? 'সবসময়! আর কিছু লাগলে বলুন।' : 'Anytime! Tell me if you need anything else.';
    case 'identity':
      return aboutAponAnswer('identity', bn);
    case 'wellbeing':
      return bn ? 'আমি ঠিক আছি, ধন্যবাদ! আপনাকে কীভাবে সাহায্য করতে পারি?' : 'I’m good, thanks! How can I help you?';
    case 'ack':
      return bn ? 'ঠিক আছে। পরের কাজটা বলুন।' : 'Got it. What’s next?';
    case 'greeting':
    default:
      return bn
        ? 'হ্যালো! একটা টাস্ক বানাতে, তথ্য সেভ করতে বা প্রশ্ন করতে পারেন। “সাহায্য” লিখলে সব দেখাব।'
        : 'Hello! You can add a task, save a note, or ask a question. Type “help” to see everything.';
  }
}
