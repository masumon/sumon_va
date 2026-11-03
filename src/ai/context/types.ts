import type { MoneyQuestion } from '../../services/life-query-service';
import type { NlpIntent } from '../nlp/types';

export interface OrchestrationContext {
  lastTaskText?: string;
  lastMemoryQuery?: string;
  lastIntent?: Exclude<NlpIntent, 'UNKNOWN'>;
  /** Salient words from the last question/search — lets a terse follow-up ("আর ভিসারটা?") inherit the topic. */
  lastKeywords?: string[];
  /**
   * What the last money question turned out to be asking.
   *
   * "গত মাসে চিকিৎসায় কত?" followed by "আর তার আগের মাসে?" is one conversation: the
   * second sentence names only a period, and without the first it is a question about
   * nothing in particular. Kept as the parsed shape rather than the words, because it is
   * the *subject* that carries over, not the phrasing.
   */
  lastMoney?: MoneyQuestion;
  /** The category of the last expense recorded — what "ওটার জন্য আরও ৫০০" points at. */
  lastExpenseCategory?: string;
}

export interface ResolvedContext {
  taskText?: string;
  memoryQuery?: string;
}
