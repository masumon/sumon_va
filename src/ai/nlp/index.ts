import { extractEntities } from './entities';
import { classifyIntent } from './intent';
import { detectAppIntent } from '../capabilities';
import { STEP_SEPARATORS } from './lexicon';
import { normalizeKeepCase, normalizeText, tokenize } from './normalize';
import type { NlpResult } from './types';

export * from './types';
export * from './normalize';
export * from './intent';
export * from './entities';
export * from './lexicon';
export * from './keywords';

export function parseLocalNlp(input: string, now = new Date()): NlpResult {
  const normalizedText = normalizeText(input);
  const tokens = tokenize(normalizedText);
  // Which part of the app first: a sentence that clearly asks about planning, health, a
  // debt balance, the app's state, backup or a screen is answered there. Everything else
  // (tasks, memories, money being recorded, new debts) goes to the core rules unchanged.
  const app = detectAppIntent(normalizedText);
  if (app) {
    const appIntent = app.kind === 'query' ? 'APP_QUERY' : app.kind === 'command' ? 'APP_COMMAND' : 'OPEN_SCREEN';
    return { normalizedText, tokens, intent: appIntent, confidence: 0.92, entities: { app } };
  }
  const { intent, confidence } = classifyIntent(normalizedText);
  const entities = extractEntities(normalizedText, intent, now, normalizeKeepCase(input, true));

  return { normalizedText, tokens, intent, confidence, entities };
}

/**
 * Split a compound instruction ("call the bank, then pay rent and email Sam") into one
 * parsed result per step. Returns a single-element array when there is no meaningful split.
 */
export function parseLocalNlpMulti(input: string, now = new Date()): NlpResult[] {
  const normalized = normalizeText(input);
  const parts = normalized
    .split(STEP_SEPARATORS)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  if (parts.length < 2) return [parseLocalNlp(input, now)];
  const results = parts.map((part) => parseLocalNlp(part, now));
  // Only treat it as multi-step if at least two parts resolve to an actionable intent.
  const actionable = results.filter((r) => r.intent === 'CREATE_TASK' || r.intent === 'CREATE_MEMORY').length;
  return actionable >= 2 ? results : [parseLocalNlp(input, now)];
}
