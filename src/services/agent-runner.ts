import type { SQLiteDatabase } from 'expo-sqlite';
import type { TurnPlan } from '../ai/planner/planner';
import { toolFor } from '../ai/agent/tools';
import { recordAssistantTurn } from '../ai/assistant/trace';
import { executeAiAction, type ActionExecutionContext, type ActionExecutionResult } from './ai-action-executor';
import { resetSemanticMemoryIndex } from './semantic-memory-service';
import { verifyActionResult } from './action-verification';

// The agent runner: executes a validated multi-step plan, one step at a time, on the
// device. It never plans — it only runs what the planner produced. Each step is:
//   run → verify (result type matches the tool's declared expectation) → record.
// A failed step does not abort the plan; the rest still run (best-effort), and the
// overall status reflects what actually happened.

// WAITING: a money step written nothing yet — it waits for the wallet (and source) the
// person picks on আপন's card, like a single money sentence does.
export type StepState = 'DONE' | 'FAILED' | 'SKIPPED' | 'WAITING';

type NeedsWallet = Extract<ActionExecutionResult, { type: 'NEEDS_WALLET' }>;

export interface StepOutcome {
  id: number;
  text: string;
  state: StepState;
  resultType?: ActionExecutionResult['type'];
  note?: string;
}

export interface PlanRun {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  outcomes: StepOutcome[];
  results: ActionExecutionResult[];
  /** Money steps waiting for their wallet card, in plan order. */
  waiting: { text: string; result: NeedsWallet }[];
}

export async function runPlan(
  db: SQLiteDatabase,
  plan: TurnPlan,
  ctx: ActionExecutionContext = {},
): Promise<PlanRun> {
  const startedAt = Date.now();
  const outcomes: StepOutcome[] = [];
  const results: ActionExecutionResult[] = [];
  const waiting: PlanRun['waiting'] = [];
  let mutatedMemory = false;

  for (const step of plan.steps) {
    if (step.status !== 'READY' || step.action.type === 'CLARIFY') {
      outcomes.push({ id: step.id, text: step.text, state: 'SKIPPED', note: step.status });
      continue;
    }
    const tool = toolFor(step.action);
    try {
      const result = await executeAiAction(db, step.action, ctx);
      // A step only counts as DONE once its write is read back from the database.
      const problem = await verifyActionResult(db, result);
      if (problem) {
        outcomes.push({ id: step.id, text: step.text, state: 'FAILED', resultType: result.type, note: `not-verified:${problem}` });
        continue;
      }
      results.push(result);
      // Not a failure: the entry waits for the person's wallet choice (it was marked FAILED
      // as "unexpected-result" and the money silently dropped).
      if (result.type === 'NEEDS_WALLET') {
        waiting.push({ text: step.text, result });
        outcomes.push({ id: step.id, text: step.text, state: 'WAITING', resultType: result.type });
        continue;
      }
      if (tool && result.type !== tool.expect) {
        outcomes.push({ id: step.id, text: step.text, state: 'FAILED', resultType: result.type, note: 'unexpected-result' });
        continue;
      }
      if (tool?.mutates && (step.action.type === 'CREATE_MEMORY')) mutatedMemory = true;
      outcomes.push({ id: step.id, text: step.text, state: 'DONE', resultType: result.type });
    } catch (error) {
      outcomes.push({
        id: step.id,
        text: step.text,
        state: 'FAILED',
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Keep semantic recall consistent with what the plan just wrote.
  if (mutatedMemory) resetSemanticMemoryIndex();

  const ran = outcomes.filter((o) => o.state !== 'SKIPPED');
  const done = ran.filter((o) => o.state === 'DONE').length;
  const status: PlanRun['status'] =
    done === 0 ? 'FAILED' : done === ran.length ? 'COMPLETED' : 'PARTIAL';

  recordAssistantTurn({
    at: new Date().toISOString(),
    input: plan.steps.map((s) => s.text).join(' | '),
    source: 'text',
    intent: 'PLAN',
    confidence: plan.readyCount / Math.max(1, plan.steps.length),
    status,
    actionType: 'RUN_PLAN',
    outcome: `${done}/${ran.length} done`,
    durationMs: Date.now() - startedAt,
    detail: outcomes.map((o) => `#${o.id} ${o.state}${o.note ? ` (${o.note})` : ''}`),
  });

  return { status, outcomes, results, waiting };
}
