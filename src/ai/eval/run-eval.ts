import { parseLocalNlp } from '../nlp';
import { planTurn } from '../planner';
import { INTENT_CASES, PLAN_CASES, type IntentCase, type PlanCase } from './scenarios';

// Deterministic, offline evaluation of the assistant's understanding layer. No model,
// no database — it re-parses the fixed scenario set and scores intent routing, keyword
// extraction and plan detection. Wire it into diagnostics or CI to catch silent
// regressions from a lexicon change.

export interface EvalFailure {
  input: string;
  field: 'intent' | 'keywords' | 'multi' | 'readyTypes';
  expected: string;
  got: string;
}

export interface EvalReport {
  total: number;
  passed: number;
  accuracy: number;
  failures: EvalFailure[];
}

export function evaluateIntents(cases: IntentCase[] = INTENT_CASES): EvalReport {
  const failures: EvalFailure[] = [];
  for (const c of cases) {
    const parsed = parseLocalNlp(c.input);
    if (parsed.intent !== c.intent) {
      failures.push({ input: c.input, field: 'intent', expected: c.intent, got: parsed.intent });
      continue;
    }
    if (c.expectKeywords?.length) {
      const kw = (parsed.entities.keywords ?? []).join(' ').toLowerCase();
      const missing = c.expectKeywords.filter((k) => !kw.includes(k.toLowerCase()));
      if (missing.length) {
        failures.push({ input: c.input, field: 'keywords', expected: c.expectKeywords.join(','), got: kw || '∅' });
      }
    }
  }
  const passed = cases.length - failures.length;
  return { total: cases.length, passed, accuracy: passed / cases.length, failures };
}

export function evaluatePlans(cases: PlanCase[] = PLAN_CASES): EvalReport {
  const failures: EvalFailure[] = [];
  for (const c of cases) {
    const plan = planTurn(c.input);
    if (plan.multi !== c.multi) {
      failures.push({ input: c.input, field: 'multi', expected: String(c.multi), got: String(plan.multi) });
      continue;
    }
    if (c.readyTypes) {
      const got = plan.steps.filter((s) => s.status === 'READY').map((s) => s.action.type);
      if (got.join(',') !== c.readyTypes.join(',')) {
        failures.push({ input: c.input, field: 'readyTypes', expected: c.readyTypes.join(','), got: got.join(',') });
      }
    }
  }
  const passed = cases.length - failures.length;
  return { total: cases.length, passed, accuracy: passed / cases.length, failures };
}

/** One combined report for an in-app "run self-check" button. */
export function evaluateAssistant(): { intents: EvalReport; plans: EvalReport; ok: boolean } {
  const intents = evaluateIntents();
  const plans = evaluatePlans();
  return { intents, plans, ok: intents.accuracy >= 0.9 && plans.failures.length === 0 };
}
