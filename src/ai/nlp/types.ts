import type { AppIntentSpec } from '../capabilities';

export type NlpIntent =
  | 'CREATE_TASK'
  | 'COMPLETE_TASK'
  | 'LIST_TASKS'
  | 'RESCHEDULE_TASK'
  | 'CREATE_MEMORY'
  | 'SEARCH_MEMORY'
  | 'ANSWER_QUESTION'
  | 'RECORD_EXPENSE'
  | 'CREATE_DEBT'
  | 'ANALYZE_SPENDING'
  /** Any other part of the app: planning, health, debts, search, status, backup, screens. */
  | 'APP_QUERY'
  | 'APP_COMMAND'
  | 'OPEN_SCREEN'
  | 'HELP'
  | 'SMALL_TALK'
  | 'UNKNOWN';

export interface DateEntity {
  raw: string;
  isoDate: string;
  confidence: number;
}

export interface TimeEntity {
  raw: string;
  minutes: number;
  confidence: number;
}

export type NlpPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface NlpEntities {
  /** Set only for APP_QUERY / APP_COMMAND / OPEN_SCREEN — what `capabilities.ts` read. */
  app?: AppIntentSpec;
  /** How many months an analysis request covers ("গত তিন মাস" → 3). */
  periodMonths?: number;
  taskText?: string;
  /** "প্রতিদিন / রোজ / প্রতি সপ্তাহে / প্রতি মাসে" — a task that repeats (rc.6 QA T16). */
  recurrence?: 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY';
  memoryText?: string;
  query?: string;
  /** The full natural-language question, kept verbatim for the retrieval + answer pipeline. */
  question?: string;
  /** Salient content words pulled from the input (interrogatives / stop-words removed). */
  keywords?: string[];
  date?: DateEntity;
  time?: TimeEntity;
  /** Priority inferred from urgency keywords ("urgent", "জরুরি", "!!!"). */
  priority?: NlpPriority;
  /** Auto-suggested tags from content nouns ("office", "ব্যাংক" → #work / #money). */
  tags?: string[];
  /**
   * Money the sentence says has already moved — "৫০০ টাকা বাজারে খরচ".
   *
   * Only ever set for RECORD_EXPENSE, and only when a sum was actually spoken. The
   * category is whatever noun sat beside it, or undefined: this layer reads what was
   * said and never fills a blank on the speaker's behalf, because the thing being
   * written here is a ledger entry.
   */
  money?: MoneyEntity;
  /**
   * Money moving between the speaker and a named person, as borrowing or lending — not a
   * purchase and not a gift. Only ever set for CREATE_DEBT, and only when a sum was
   * actually spoken; the person's name is optional (a bare "ধার নিলাম" is still a debt,
   * just one the confirmation screen must ask "from whom").
   */
  debt?: DebtEntity;
}

export interface MoneyEntity {
  kind: 'INCOME' | 'EXPENSE';
  amountPaisa: number;
  category?: string;
  /** The category was a pointer ("ওটার জন্য") — resolve it from context, never guess. */
  categoryRef?: boolean;
}

export interface DebtEntity {
  /** DEBT = the speaker borrowed (owes it); RECEIVABLE = the speaker lent (is owed it). */
  direction: 'DEBT' | 'RECEIVABLE';
  amountPaisa: number;
  personName?: string;
}

export interface NlpResult {
  normalizedText: string;
  tokens: string[];
  intent: NlpIntent;
  confidence: number;
  entities: NlpEntities;
}
