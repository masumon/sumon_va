import type { NlpResult } from '../nlp/types';
import type { CommandTopic, OpenReason, QueryTopic, ScreenId } from '../capabilities';

export type OrchestratorStatus = 'READY' | 'NEEDS_INPUT' | 'UNSUPPORTED';

export type OrchestratedAction =
  | {
      type: 'CREATE_TASK';
      taskText: string;
      dueDate?: string;
      dueMinutes?: number;
      recurrence?: 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY';
    }
  | {
      type: 'COMPLETE_TASK';
      taskText: string;
    }
  | {
      type: 'LIST_TASKS';
    }
  | {
      type: 'RESCHEDULE_TASK';
      taskText: string;
      dueDate?: string;
      dueMinutes?: number;
    }
  | {
      type: 'CREATE_MEMORY';
      content: string;
      tags?: string[];
    }
  | {
      type: 'SEARCH_MEMORY';
      query: string;
    }
  | {
      type: 'ANSWER_QUESTION';
      question: string;
      keywords: string[];
    }
  | {
      /**
       * Money that has already moved, said out loud.
       *
       * Carries only what was actually heard. Nothing is inferred: a sentence with no
       * category names none, and the screen asks rather than the parser guessing, because
       * this is the one assistant action that writes to the ledger.
       */
      type: 'RECORD_EXPENSE';
      kind: 'INCOME' | 'EXPENSE';
      amountPaisa: number;
      category?: string;
      /** The sentence as spoken, kept for the note so nothing said is thrown away. */
      note: string;
      occurredOn?: string;
    }
  | {
      /**
       * Borrowing or lending with a named person — the flagship module the assistant
       * could not reach at all before (F-011). Goes through the same `createDebt` /
       * `createReceivable` every debt screen uses, so a spoken loan is indistinguishable
       * from a typed one once it lands.
       */
      type: 'CREATE_DEBT';
      direction: 'DEBT' | 'RECEIVABLE';
      amountPaisa: number;
      personName: string;
      note: string;
      occurredOn?: string;
    }
  | {
      type: 'SHOW_HELP';
    }
  | {
      type: 'SMALL_TALK';
      text: string;
    }
  | { type: 'ANALYZE_SPENDING'; months: number }
  | { type: 'APP_QUERY'; topic: QueryTopic; subject?: string }
  | { type: 'APP_COMMAND'; topic: CommandTopic; subject?: string }
  | { type: 'OPEN_SCREEN'; screen: ScreenId; reason: OpenReason }
  | {
      type: 'CLARIFY';
      reason:
        | 'UNKNOWN_INTENT'
        | 'MISSING_TASK_TEXT'
        | 'MISSING_TASK_REFERENCE'
        | 'MISSING_MEMORY_TEXT'
        | 'MISSING_QUERY'
        | 'MISSING_QUESTION'
        | 'MISSING_SCHEDULE'
        | 'MISSING_AMOUNT'
        | 'MISSING_PERSON'
        | 'MISSING_CATEGORY_REFERENCE';
    };

export interface OrchestratorResult {
  status: OrchestratorStatus;
  action: OrchestratedAction;
  nlp: NlpResult;
}
