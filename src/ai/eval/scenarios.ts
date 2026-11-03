import type { NlpIntent } from '../nlp/types';

// A fixed, hand-labelled evaluation set for the local assistant. It is the regression
// net for "did a lexicon tweak quietly break intent routing?" — run by
// tests/assistant-eval.test.ts and available for an in-app self-check.

export interface IntentCase {
  input: string;
  intent: NlpIntent;
  /** Keywords/entities we expect to survive extraction (substring match, any language). */
  expectKeywords?: string[];
}

export const INTENT_CASES: IntentCase[] = [
  // CREATE_TASK
  { input: 'call the supplier tomorrow at 9am', intent: 'CREATE_TASK' },
  { input: 'remind me to pay the rent on friday', intent: 'CREATE_TASK' },
  { input: 'pick up medicine', intent: 'CREATE_TASK' },
  { input: 'আগামীকাল সকাল ৯টায় ডাক্তারকে ফোন করতে হবে', intent: 'CREATE_TASK' },
  { input: 'কাল ব্যাংকে যেতে হবে', intent: 'CREATE_TASK' },
  { input: 'বিকাল ৫টায় রিপোর্ট জমা দিতে হবে পরশু', intent: 'CREATE_TASK' },
  // COMPLETE_TASK
  { input: 'done with the report', intent: 'COMPLETE_TASK' },
  { input: 'রিপোর্টের কাজ শেষ করেছি', intent: 'COMPLETE_TASK' },
  { input: 'কাজটা হয়ে গেছে', intent: 'COMPLETE_TASK' },
  // LIST_TASKS
  { input: 'show my tasks', intent: 'LIST_TASKS' },
  { input: 'আজকের কাজগুলো দেখাও', intent: 'LIST_TASKS' },
  { input: 'কি কি কাজ বাকি আছে', intent: 'LIST_TASKS' },
  // RESCHEDULE_TASK
  { input: 'reschedule the meeting to monday', intent: 'RESCHEDULE_TASK' },
  { input: 'মিটিংটা পিছিয়ে দাও আগামীকাল', intent: 'RESCHEDULE_TASK' },
  // CREATE_MEMORY
  { input: 'remember the home wifi password is hunter2', intent: 'CREATE_MEMORY' },
  { input: 'মনে রাখো আমার পাসপোর্ট নম্বর AB123456', intent: 'CREATE_MEMORY', expectKeywords: ['পাসপোর্ট'] },
  { input: 'বাসার গ্যাসের কল বন্ধ থাকে শুক্রবার নোট করো', intent: 'CREATE_MEMORY' },
  // SEARCH_MEMORY
  { input: 'find the report i saved', intent: 'SEARCH_MEMORY' },
  { input: 'আমার দোকান কখন বন্ধ থাকে খুঁজে দাও', intent: 'SEARCH_MEMORY' },
  { input: 'আমার সব মেমোরি দেখাও', intent: 'SEARCH_MEMORY' },
  { input: 'show all my notes', intent: 'SEARCH_MEMORY' },
  // ANSWER_QUESTION
  { input: 'আমার পাসপোর্টের মেয়াদ কত?', intent: 'ANSWER_QUESTION', expectKeywords: ['পাসপোর্ট', 'মেয়াদ'] },
  { input: 'what is my wifi password?', intent: 'ANSWER_QUESTION', expectKeywords: ['wifi', 'password'] },
  { input: 'আমার গাড়ির নম্বর কত', intent: 'ANSWER_QUESTION', expectKeywords: ['গাড়ি'] },
  { input: 'when is my flight?', intent: 'ANSWER_QUESTION', expectKeywords: ['flight'] },
  { input: 'আমার বাসার ঠিকানা কী', intent: 'ANSWER_QUESTION' },
  // HELP
  { input: 'help', intent: 'HELP' },
  { input: 'তুমি কী কী করতে পারো', intent: 'HELP' },
  { input: 'what can you do', intent: 'HELP' },
  { input: 'অ্যাপটা কী কাজ করে', intent: 'HELP' },
  // SMALL_TALK
  { input: 'hi', intent: 'SMALL_TALK' },
  { input: 'ধন্যবাদ', intent: 'SMALL_TALK' },
  { input: 'তুমি কে?', intent: 'SMALL_TALK' },
  { input: 'assalamu alaikum', intent: 'SMALL_TALK' },
  // UNKNOWN
  { input: 'আজ আকাশ অনেক সুন্দর', intent: 'UNKNOWN' },
  { input: 'lorem ipsum dolor sit', intent: 'UNKNOWN' },
];

export interface PlanCase {
  input: string;
  multi: boolean;
  readyTypes?: string[];
}

export const PLAN_CASES: PlanCase[] = [
  { input: 'call the supplier tomorrow at 9am, then email the report', multi: true, readyTypes: ['CREATE_TASK', 'CREATE_TASK'] },
  { input: 'buy the groceries and call the landlord', multi: true },
  { input: 'মনে রাখো আমার পাসপোর্ট নম্বর 1234, আর কাল ব্যাংকে যেতে হবে', multi: true },
  { input: 'call mom tomorrow at 9am', multi: false },
  { input: 'আমার পাসপোর্টের মেয়াদ কত?', multi: false },
];
