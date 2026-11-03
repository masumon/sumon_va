import type { NlpEntities, NlpIntent } from '../nlp/types';
import type { OrchestrationContext, ResolvedContext } from './types';

export * from './types';

/**
 * Resolve only short-lived conversational references. This function is pure and
 * never reads persistence or performs fuzzy matching; callers provide the
 * explicitly retained context.
 */
export function resolveContext(
  entities: NlpEntities,
  context: OrchestrationContext = {},
): ResolvedContext {
  return {
    taskText: entities.taskText ?? context.lastTaskText,
    memoryQuery: entities.query ?? context.lastMemoryQuery,
  };
}

export function updateContext(
  intent: NlpIntent,
  entities: NlpEntities,
  previous: OrchestrationContext = {},
): OrchestrationContext {
  const keywords = entities.keywords?.length ? entities.keywords : previous.lastKeywords;
  return {
    lastTaskText: entities.taskText ?? previous.lastTaskText,
    lastMemoryQuery: entities.query ?? previous.lastMemoryQuery,
    lastIntent: intent === 'UNKNOWN' ? previous.lastIntent : intent,
    lastExpenseCategory: (entities.money?.kind === 'EXPENSE' && entities.money.category) || previous.lastExpenseCategory,
    lastKeywords: keywords,
  };
}
