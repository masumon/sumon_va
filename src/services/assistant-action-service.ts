import type { SQLiteDatabase } from 'expo-sqlite';
import type { ScreenId } from '../ai/capabilities';
import type { OrchestratedAction } from '../ai/orchestrator';
import type { Memory } from '../types/memory-model';
import type { Task } from '../types/task-model';
import type { FinanceEntry, FundSource } from './finance-service';
import type { Account } from './debt/types';
import type { MoneyQuestion } from './life-query-service';
import { AmbiguousTaskError, executeAiAction, executeAiActionOnTask, savePendingEntry, type ActionExecutionContext, type ActionExecutionResult, type PendingEntry } from './ai-action-executor';
import type { Wallet } from './wallet-service';
import type { AnswerResult } from './question-answering-service';
import type { HelpTopic } from '../ai/assistant/conversation';
import { ActionNotVerifiedError, verifyActionResult } from './action-verification';

export type PendingTaskChoice = Extract<OrchestratedAction, { type: 'COMPLETE_TASK' | 'RESCHEDULE_TASK' }>;

export type AssistantExecutionResult =
  | { type: 'TASK_CREATED'; message: string; task: Task }
  | { type: 'TASK_COMPLETED'; message: string; task: Task }
  | { type: 'TASK_LIST'; message: string; tasks: Task[] }
  | { type: 'TASK_RESCHEDULED'; message: string; task: Task }
  | { type: 'MEMORY_CREATED'; message: string; memory: Memory }
  | { type: 'MEMORY_SEARCH'; message: string; memories: Memory[] }
  | { type: 'ANSWER'; message: string; answer: AnswerResult; askedMoney?: MoneyQuestion }
  | { type: 'ENTRY_RECORDED'; message: string; entry: FinanceEntry }
  | { type: 'DEBT_CREATED'; message: string; account: Account; personName: string }
  | { type: 'HELP'; message: string; intro: string; topics: HelpTopic[]; outro: string }
  | { type: 'SMALL_TALK'; message: string }
  | { type: 'ANALYSIS'; message: string; trace: string[] }
  | { type: 'APP_REPLY'; message: string; open?: ScreenId; navigate?: boolean; trace: string[] }
  | { type: 'NEEDS_TASK_CHOICE'; message: string; candidates: Task[]; pending: PendingTaskChoice }
  | { type: 'NEEDS_WALLET'; message: string; wallets: Wallet[]; pending: PendingEntry };

function present(result: ActionExecutionResult): AssistantExecutionResult {
  switch (result.type) {
    case 'TASK_CREATED': return { type: 'TASK_CREATED', message: 'Task created locally.', task: result.task };
    case 'TASK_COMPLETED': return { type: 'TASK_COMPLETED', message: 'Task completed locally.', task: result.task };
    case 'TASKS_LISTED': return { type: 'TASK_LIST', message: `${result.tasks.length} task(s) found locally.`, tasks: result.tasks };
    case 'TASK_RESCHEDULED': return { type: 'TASK_RESCHEDULED', message: 'Task rescheduled locally.', task: result.task };
    case 'MEMORY_CREATED': return { type: 'MEMORY_CREATED', message: 'Memory saved locally.', memory: result.memory };
    case 'MEMORIES_FOUND': return { type: 'MEMORY_SEARCH', message: `${result.memories.length} memory result(s) found locally.`, memories: result.memories };
    case 'QUESTION_ANSWERED':
      return { type: 'ANSWER', message: result.answer.text, answer: result.answer, askedMoney: result.askedMoney };
    case 'ENTRY_RECORDED': return { type: 'ENTRY_RECORDED', message: 'Entry recorded locally.', entry: result.entry };
    case 'NEEDS_WALLET': return { type: 'NEEDS_WALLET', message: 'Which wallet did the money move through?', wallets: result.wallets, pending: result.pending };
    case 'DEBT_CREATED': return { type: 'DEBT_CREATED', message: 'Debt recorded locally.', account: result.account, personName: result.personName };
    case 'HELP_SHOWN': return { type: 'HELP', message: result.intro, intro: result.intro, topics: result.topics, outro: result.outro };
    case 'SMALL_TALK_REPLY': return { type: 'SMALL_TALK', message: result.message };
    case 'SPENDING_ANALYZED': return { type: 'ANALYSIS', message: result.text, trace: result.trace };
    case 'APP_REPLY': return { type: 'APP_REPLY', message: result.text, open: result.open, navigate: result.navigate, trace: result.trace };
  }
}

export async function executeAssistantAction(
  db: SQLiteDatabase,
  action: Exclude<OrchestratedAction, { type: 'CLARIFY' }>,
  ctx: ActionExecutionContext = {},
): Promise<AssistantExecutionResult> {
  try {
    const done = await executeAiAction(db, action, ctx);
    const problem = await verifyActionResult(db, done);
    if (problem) throw new ActionNotVerifiedError(problem);
    return present(done);
  } catch (error) {
    // A reference that matches several tasks is not a failure — surface the choices.
    if (error instanceof AmbiguousTaskError && (action.type === 'COMPLETE_TASK' || action.type === 'RESCHEDULE_TASK')) {
      return { type: 'NEEDS_TASK_CHOICE', message: 'Which task did you mean?', candidates: error.candidates, pending: action };
    }
    // T03: no task by that name is an answer, not a failure — say so and offer the way on,
    // instead of a red "could not do it" that leaves the person guessing.
    const missing = error instanceof Error && error.message === 'Referenced task was not found';
    if (missing && (action.type === 'COMPLETE_TASK' || action.type === 'RESCHEDULE_TASK')) {
      const bn = (ctx.language ?? 'bn') === 'bn';
      const named = action.taskText.trim();
      // "ওষুধ শেষ", "গ্যাস শেষ" — a thing that ran out, not a task that was done (rc.14
      // review). Offer the reminder to buy it instead of "no task by that name".
      if (action.type === 'COMPLETE_TASK' && /^(?:ওষুধ|ঔষধ|ট্যাবলেট|ইনসুলিন|গ্যাস|সিলিন্ডার|চাল|ডাল|তেল|দুধ|চিনি|লবণ|পেঁয়াজ|আটা|সাবান|ডিম|মোবাইলের\s*টাকা|ব্যালেন্স|রিচার্জ|মিটারের\s*টাকা|বিদ্যুৎ)\S*/u.test(named)) {
        return {
          type: 'APP_REPLY',
          message: bn
            ? `"${named}" ফুরিয়ে গেছে? চাইলে কিনতে মনে করিয়ে দিই — যেমন বলুন: "আজ সন্ধ্যা ৬টায় ${named} কিনব"।`
            : `Out of "${named}"? I can remind you to buy it — say, for example: "buy ${named} today at 6pm".`,
          open: 'planning',
          trace: ['task-not-found', 'ran-out'],
        };
      }
      return {
        type: 'APP_REPLY',
        message: bn
          ? `"${named}" নামে কোনো কাজ পাওয়া যায়নি।\nচাইলে নতুন করে যোগ করতে পারেন — যেমন বলুন: "কাল সকাল ১০টায় ${named}"।`
          : `No task called "${named}" was found.\nYou can add it now — say, for example: "${named} tomorrow at 10".`,
        open: 'planning',
        trace: ['task-not-found'],
      };
    }
    throw error;
  }
}

/** Write the waiting money movement against the wallet (and source) the person picked. */
export async function resolveAssistantWallet(
  db: SQLiteDatabase,
  pending: PendingEntry,
  walletId: string,
  source: { fundSource: FundSource | null; fundAccountId?: string | null; fundNote?: string | null } = { fundSource: null },
): Promise<AssistantExecutionResult> {
  const saved = await savePendingEntry(db, pending, walletId, source);
  const problem = await verifyActionResult(db, saved);
  if (problem) throw new ActionNotVerifiedError(problem);
  return present(saved);
}

/** Run a pending COMPLETE/RESCHEDULE against the task the user picked from the choice list. */
export async function resolveAssistantTaskChoice(
  db: SQLiteDatabase,
  pending: PendingTaskChoice,
  taskId: string,
): Promise<AssistantExecutionResult> {
  const done = await executeAiActionOnTask(db, pending, taskId);
  const problem = await verifyActionResult(db, done);
  if (problem) throw new ActionNotVerifiedError(problem);
  return present(done);
}

export type { Memory, Task };
