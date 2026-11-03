import type { AssistantExecutionResult } from '../../services/assistant-action-service';

// One or two natural next steps after every reply, so the conversation keeps going the
// way a person would take it — after writing an expense, the month's total; after today's
// plan, the inbox. Every chip is a sentence the Assistant is known to read correctly
// (tests/assistant-app-domains.test.ts plans each one), so tapping never dead-ends.

type Chips = { bn: string[]; en: string[] };

const BY_TYPE: Partial<Record<AssistantExecutionResult['type'], Chips>> = {
  TASK_CREATED: { bn: ['আজ কী কী করতে হবে?'], en: ['What should I do today?'] },
  TASK_COMPLETED: { bn: ['আজ কী কী করতে হবে?'], en: ['What should I do today?'] },
  TASK_RESCHEDULED: { bn: ['আজ কী কী করতে হবে?'], en: ['What should I do today?'] },
  TASK_LIST: { bn: ['ইনবক্সের কাজগুলো আজকের প্ল্যানে দাও'], en: ['Plan my inbox for today'] },
  ENTRY_RECORDED: { bn: ['এই মাসে কত খরচ হয়েছে?', 'হাতে কত টাকা আছে?'], en: ['How much did I spend this month?', 'How much money do I have?'] },
  DEBT_CREATED: { bn: ['আমার মোট দেনা কত?'], en: ['How much do I owe?'] },
  ANALYSIS: { bn: ['হাতে কত টাকা আছে?'], en: ['How much money do I have?'] },
  MEMORY_CREATED: { bn: ['শেষ ব্যাকআপ কবে?'], en: ['When was the last backup?'] },
};

const BY_TRACE: [string, Chips][] = [
  ['app-query:plan-today', { bn: ['ইনবক্সের কাজগুলো আজকের প্ল্যানে দাও'], en: ['Plan my inbox for today'] }],
  ['app-query:next-dose', { bn: ['কোন ওষুধ বাদ গেছে?'], en: ['Did I miss any dose?'] }],
  ['app-query:missed-doses', { bn: ['পরের ওষুধ কখন?'], en: ['When is my next dose?'] }],
  ['app-query:backup-status', { bn: ['এখনই ব্যাকআপ নাও'], en: ['Back up now'] }],
  ['app-query:debt-summary', { bn: ['হাতে কত টাকা আছে?'], en: ['How much money do I have?'] }],
  ['app-query:balance', { bn: ['গত ৩ মাসের খরচ বিশ্লেষণ করো'], en: ['Analyse my spending for 3 months'] }],
  ['app-query:app-status', { bn: ['রিমাইন্ডার কাজ করছে?', 'শেষ ব্যাকআপ কবে?'], en: ['Are my reminders working?', 'When was the last backup?'] }],
];

export function followUps(result: AssistantExecutionResult, bn: boolean, asked?: string): string[] {
  const pick = (c: Chips) => (bn ? c.bn : c.en);
  if (result.type === 'APP_REPLY') {
    const hit = BY_TRACE.find(([key]) => result.trace.includes(key));
    return hit ? pick(hit[1]) : [];
  }
  if (result.type === 'ANSWER' && result.answer.type !== 'ANSWER') {
    // Not in the saved notes — offer the wider search, which also looks at money, people
    // and health, instead of leaving "I don't know" as the last word.
    const words = asked?.trim();
    return words ? [bn ? `সব জায়গায় ${words.replace(/[?？।]+$/u, '')} খোঁজো` : `Search everywhere for ${words.replace(/[?？.]+$/u, '')}`] : [];
  }
  const chips = BY_TYPE[result.type];
  return chips ? pick(chips) : [];
}
