import type { OrchestratedAction } from '../orchestrator';

type Reason = Extract<OrchestratedAction, { type: 'CLARIFY' }>['reason'];

// The one specific thing that is missing, asked for plainly — instead of one generic
// "didn't understand" for every case. UNKNOWN_INTENT keeps the screen's own fallback copy.
const QUESTIONS: Partial<Record<Reason, { bn: string; en: string }>> = {
  MISSING_TASK_TEXT: { bn: 'কী কাজ মনে রাখব? যেমন: "কাল ৫টায় বাজার করা"', en: 'What should I remind you about? e.g. "shopping tomorrow at 5"' },
  MISSING_TASK_REFERENCE: { bn: 'কোন কাজটার কথা বলছেন? কাজটার নাম লিখুন।', en: 'Which task do you mean? Type its name.' },
  MISSING_MEMORY_TEXT: { bn: 'কী মনে রাখব, সেটা লিখুন।', en: 'What should I remember?' },
  MISSING_QUERY: { bn: 'কী খুঁজব?', en: 'What should I look for?' },
  MISSING_QUESTION: { bn: 'কী জানতে চান, একটু খুলে বলুন।', en: 'What would you like to know?' },
  MISSING_SCHEDULE: { bn: 'কোন দিন? যেমন: "কাল ৫টায়"', en: 'Which day? e.g. "tomorrow at 5"' },
  MISSING_AMOUNT: { bn: 'কত টাকা?', en: 'How much?' },
  MISSING_PERSON: { bn: 'কার সাথে লেনদেন? নামটা লিখুন।', en: 'Who was it with? Type the name.' },
  MISSING_CATEGORY_REFERENCE: { bn: 'কোন খরচের জন্য টাকাটা যোগ করতে চান? খাতের নাম লিখুন, যেমন "বাজার"।', en: 'Which expense is this for? Type the category, e.g. "groceries".' },
};

export function clarifyQuestion(action: OrchestratedAction, bn: boolean): string | null {
  if (action.type !== 'CLARIFY') return null;
  const q = QUESTIONS[action.reason];
  return q ? (bn ? q.bn : q.en) : null;
}
