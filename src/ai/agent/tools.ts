import type { OrchestratedAction } from '../orchestrator';
import { describeAppAction } from '../capabilities';
import type { ActionExecutionResult } from '../../services/ai-action-executor';

// The assistant's "tools" — the closed set of things the agent is allowed to do on the
// user's device. Every executable action maps to exactly one tool. Keeping this as an
// explicit table (rather than an open-ended function bus) is a guardrail: the planner
// can only ever produce these, and the runner can verify each result against the tool's
// declared `expect` type.

export type ToolName = Exclude<OrchestratedAction['type'], 'CLARIFY'>;

export interface ToolSpec {
  name: ToolName;
  /** Whether this tool changes stored data (used for confirm / index-refresh decisions). */
  mutates: boolean;
  /** The `ActionExecutionResult.type` a successful run must return. */
  expect: ActionExecutionResult['type'];
  label: { bn: string; en: string };
}

export const TOOLS: Record<ToolName, ToolSpec> = {
  CREATE_TASK: { name: 'CREATE_TASK', mutates: true, expect: 'TASK_CREATED', label: { bn: 'কাজ যোগ', en: 'Create task' } },
  COMPLETE_TASK: { name: 'COMPLETE_TASK', mutates: true, expect: 'TASK_COMPLETED', label: { bn: 'কাজ শেষ', en: 'Complete task' } },
  LIST_TASKS: { name: 'LIST_TASKS', mutates: false, expect: 'TASKS_LISTED', label: { bn: 'কাজের তালিকা', en: 'List tasks' } },
  RESCHEDULE_TASK: { name: 'RESCHEDULE_TASK', mutates: true, expect: 'TASK_RESCHEDULED', label: { bn: 'সময় পরিবর্তন', en: 'Reschedule task' } },
  CREATE_MEMORY: { name: 'CREATE_MEMORY', mutates: true, expect: 'MEMORY_CREATED', label: { bn: 'মেমোরি সংরক্ষণ', en: 'Save memory' } },
  SEARCH_MEMORY: { name: 'SEARCH_MEMORY', mutates: false, expect: 'MEMORIES_FOUND', label: { bn: 'মেমোরি খোঁজা', en: 'Search memory' } },
  ANSWER_QUESTION: { name: 'ANSWER_QUESTION', mutates: false, expect: 'QUESTION_ANSWERED', label: { bn: 'উত্তর দেওয়া', en: 'Answer question' } },
  RECORD_EXPENSE: { name: 'RECORD_EXPENSE', mutates: true, expect: 'ENTRY_RECORDED', label: { bn: 'হিসাব লেখা', en: 'Record entry' } },
  CREATE_DEBT: { name: 'CREATE_DEBT', mutates: true, expect: 'DEBT_CREATED', label: { bn: 'ধার/পাওনা যোগ', en: 'Record a debt' } },
  ANALYZE_SPENDING: { name: 'ANALYZE_SPENDING', mutates: false, expect: 'SPENDING_ANALYZED', label: { bn: 'খরচ বিশ্লেষণ', en: 'Analyse spending' } },
  SHOW_HELP: { name: 'SHOW_HELP', mutates: false, expect: 'HELP_SHOWN', label: { bn: 'সাহায্য', en: 'Help' } },
  SMALL_TALK: { name: 'SMALL_TALK', mutates: false, expect: 'SMALL_TALK_REPLY', label: { bn: 'কথা', en: 'Chat' } },
  APP_QUERY: { name: 'APP_QUERY', mutates: false, expect: 'APP_REPLY', label: { bn: 'অ্যাপ থেকে উত্তর', en: 'Answer from the app' } },
  APP_COMMAND: { name: 'APP_COMMAND', mutates: true, expect: 'APP_REPLY', label: { bn: 'অ্যাপে কাজ', en: 'Do it in the app' } },
  OPEN_SCREEN: { name: 'OPEN_SCREEN', mutates: false, expect: 'APP_REPLY', label: { bn: 'পাতা খোলা', en: 'Open a screen' } },
};

export function toolFor(action: OrchestratedAction): ToolSpec | null {
  return action.type === 'CLARIFY' ? null : TOOLS[action.type];
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bnNum = (value: string | number) => String(value).replace(/\d/gu, (d) => BN_DIGITS[Number(d)]!);
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** " · আজ রাত ১১:৩০" — the day and clock time a task will remind, as a person says it. */
export function scheduleLabel(dueDate: string | undefined, dueMinutes: number | undefined, bn: boolean, sep = ' · ', now = new Date()): string {
  if (!dueDate) return '';
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const [y, mo, d] = dueDate.split('-');
  const day = dueDate === isoOf(now) ? (bn ? 'আজ' : 'today')
    : dueDate === isoOf(tomorrow) ? (bn ? 'আগামীকাল' : 'tomorrow')
      : bn ? `${bnNum(Number(d))}/${bnNum(Number(mo))}/${bnNum(y!)}` : `${Number(d)}/${Number(mo)}/${y}`;
  if (dueMinutes === undefined) return `${sep}${day}`;
  const h = Math.floor(dueMinutes / 60); const min = String(dueMinutes % 60).padStart(2, '0');
  const h12 = ((h + 11) % 12) + 1;
  if (!bn) return `${sep}${day} ${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
  const period = h < 5 ? 'রাত' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  return `${sep}${day} ${period} ${bnNum(h12)}:${bnNum(min)}`;
}

/** One-line, human-readable description of what a step will do. */
export function describeAction(action: OrchestratedAction, bn: boolean): string {
  switch (action.type) {
    case 'CREATE_TASK':
      // The card shows the time it will remind, in words — it used to show only an ISO date,
      // so the card and the reminder seemed to disagree (RC.1 QA).
      return (bn ? 'কাজ: ' : 'Task: ') + action.taskText + scheduleLabel(action.dueDate, action.dueMinutes, bn);
    case 'COMPLETE_TASK':
      return (bn ? 'সম্পন্ন: ' : 'Complete: ') + action.taskText;
    case 'LIST_TASKS':
      return bn ? 'সব কাজ দেখাও' : 'Show all tasks';
    case 'ANALYZE_SPENDING':
      return bn ? `গত ${action.months} মাসের খরচ বিশ্লেষণ` : `Analyse the last ${action.months} months of spending`;
    case 'RECORD_EXPENSE': {
      // The confirmation line for the one assistant action that writes to the ledger, so
      // it says the figure and the direction plainly before anything is written.
      const taka = (action.amountPaisa / 100).toLocaleString(bn ? 'bn-BD' : 'en-US');
      const what = action.kind === 'INCOME' ? (bn ? 'আয়' : 'Income') : (bn ? 'খরচ' : 'Expense');
      return `${what}: ৳${taka}${action.category ? ` · ${action.category}` : ''}`;
    }
    case 'CREATE_DEBT': {
      // Confirmation line for the one other assistant action that writes money — states
      // the figure, the direction and the person plainly before anything is written.
      const taka = (action.amountPaisa / 100).toLocaleString(bn ? 'bn-BD' : 'en-US');
      const what = action.direction === 'DEBT'
        ? (bn ? `${action.personName}-এর কাছ থেকে ধার নিলাম` : `Borrowed from ${action.personName}`)
        : (bn ? `${action.personName}-কে ধার দিলাম` : `Lent to ${action.personName}`);
      return `${what}: ৳${taka}`;
    }
    case 'RESCHEDULE_TASK':
      return (bn ? 'সময় পরিবর্তন: ' : 'Reschedule: ') + action.taskText + scheduleLabel(action.dueDate, action.dueMinutes, bn, ' → ');
    case 'CREATE_MEMORY':
      return (bn ? 'মেমোরি: ' : 'Memory: ') + action.content;
    case 'SEARCH_MEMORY':
      return (bn ? 'খোঁজো: ' : 'Search: ') + action.query;
    case 'ANSWER_QUESTION':
      return (bn ? 'উত্তর: ' : 'Answer: ') + action.question;
    case 'SHOW_HELP':
      return bn ? 'সাহায্য দেখানো' : 'Show help';
    case 'SMALL_TALK':
      return bn ? 'কথা বলা' : 'Chat';
    case 'APP_QUERY':
    case 'APP_COMMAND':
    case 'OPEN_SCREEN':
      return describeAppAction(action, bn);
    case 'CLARIFY':
      return bn ? 'আরও তথ্য দরকার' : 'Needs more detail';
  }
}
