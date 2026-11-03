import { normalizeText } from '../nlp/normalize';
import { orchestrate, type OrchestratedAction, type OrchestratorResult } from '../orchestrator';
import type { OrchestrationContext } from '../context';
import { updateContext } from '../context';

// The planning layer. It turns one natural-language instruction — possibly a compound
// one ("mark the meeting done, then remind me to send the report tomorrow") — into an
// ordered list of validated steps. It is pure: no database, no side effects. The agent
// runner executes the plan; this module only decides *what* the steps are.

export interface PlanStep {
  id: number;
  /** The sub-instruction this step came from. */
  text: string;
  status: OrchestratorResult['status'];
  action: OrchestratedAction;
  nlp: OrchestratorResult['nlp'];
}

export interface TurnPlan {
  /** True when there are ≥2 executable steps — the caller should show a plan, not a single card. */
  multi: boolean;
  steps: PlanStep[];
  readyCount: number;
}

const MAX_STEPS = 8;

// Planner-local step separators — a superset of the NLP lexicon's (adds bare "and" /
// "আর" / "ও"), so a spoken run of chores splits the way a person means it. Kept here so
// the shared multi-parse used elsewhere is untouched.
//
// F-026: `\b` never matches around Bengali script (it only recognizes ASCII word
// characters), so every Bengali alternative here was dead — a compound instruction like
// "দুধ কেনো তারপর ব্যাংকে যাও" never split into two steps. Same letter/combining-mark
// boundary the rest of the NLP layer uses for exactly this reason.
const PLAN_SEPARATORS =
  /\s*(?:,|;|।|&|\band then\b|\bafter that\b|\bthen\b|\band also\b|\balso\b|\band\b|(?<![\p{L}\p{M}])(?:ও\s*তারপর|তারপর|এরপর|এবং|আর|ও)(?![\p{L}\p{M}]))\s*/giu;
const LEADING_CONNECTIVE = /^(?:and|also|then|next|আর|ও|এবং|তারপর|এরপর)\s+/iu;

// "…৫০০ টাকা গেছে, খরচে লিখে রাখো" is one request whose instruction comes after a comma,
// not two. A piece with no number that is only such an instruction belongs to the piece
// before it — split off, it became a note reading "খরচে লিখে রাখো".
const INSTRUCTION_TAIL = /^(?:[\p{L}\p{M}]+\s+){0,2}(?:খরচে|আয়ে|হিসাবে|হিসেবে|খাতায়)?\s*(?:লিখে\s*রাখ\S*|যোগ\s*কর\S*|লিখে\s*দাও|রেখে\s*দাও|সেভ\s*কর\S*|তুলে\s*রাখ\S*)$/u;

// "আমার প্রিয় রং নীল। এটা মনে রাখো।" is one memory, not a question plus a memory reading
// "এটা মনে রাখো". A piece that is only "(this) remember" belongs to the piece before it.
const MEMORY_TAIL = /^(?:(?:এটা|এটাও|ওটা|সেটা|কথাটা|এই\s*কথাটা)\s+)?(?:মনে\s*রাখ\S*|লিখে\s*রাখ\S*|সেভ\s*কর\S*|নোট\s*কর\S*)[\s।.!]*$|^(?:please\s+)?(?:remember|save|note)(?:\s+(?:this|that|it))?[\s.!]*$/iu;

function splitSteps(input: string): string[] {
  const normalized = normalizeText(input);
  const parts = normalized
    .split(PLAN_SEPARATORS)
    .map((p) => p.trim().replace(LEADING_CONNECTIVE, '').trim())
    .filter((p) => p.length >= 3)
    .reduce<string[]>((acc, piece) => {
      if (acc.length && !/[০-৯\d]/u.test(piece) && (INSTRUCTION_TAIL.test(piece) || MEMORY_TAIL.test(piece))) acc[acc.length - 1] += ` ${piece}`;
      else acc.push(piece);
      return acc;
    }, []);
  return parts.length ? parts.slice(0, MAX_STEPS) : [normalized];
}

/** Two READY steps whose action + key fields are identical → keep the first only. */
function actionKey(action: OrchestratedAction): string {
  return JSON.stringify(action);
}

/**
 * Build an ordered, validated plan for `input`. Context threads forward between steps
 * (so "…then reschedule it to Friday" can resolve "it" from the previous step).
 */
export function planTurn(
  input: string,
  now = new Date(),
  context: OrchestrationContext = {},
): TurnPlan {
  const pieces = splitSteps(input);

  // Single piece → a normal one-action turn; never surface a "plan".
  if (pieces.length < 2) {
    const only = orchestrate(input, now, context);
    return {
      multi: false,
      readyCount: only.status === 'READY' ? 1 : 0,
      steps: [{ id: 0, text: pieces[0] ?? input.trim(), status: only.status, action: only.action, nlp: only.nlp }],
    };
  }

  const steps: PlanStep[] = [];
  const seen = new Set<string>();
  let ctx = context;
  let id = 0;
  for (const piece of pieces) {
    const result = orchestrate(piece, now, ctx);
    if (result.status === 'READY') {
      const key = actionKey(result.action);
      if (seen.has(key)) continue;
      seen.add(key);
      ctx = updateContext(result.nlp.intent, result.nlp.entities, ctx);
    }
    steps.push({ id: id++, text: piece, status: result.status, action: result.action, nlp: result.nlp });
  }

  // "দুধ, ডিম আর রুটি কিনতে হবে" is one errand listing three things, not three steps of
  // which two ("দুধ", "ডিম") mean nothing on their own: read it whole as one task.
  const last = steps[steps.length - 1];
  const shortUnread = (s: PlanStep) => s.status === 'UNSUPPORTED' && !/[০-৯\d]/u.test(s.text) && s.text.trim().split(/\s+/u).length <= 2;
  if (last?.status === 'READY' && last.action.type === 'CREATE_TASK' && steps.slice(0, -1).some(shortUnread) && steps.slice(0, -1).every((s) => shortUnread(s) || s.status === 'READY')) {
    const whole = orchestrate(input, now, context);
    if (whole.status === 'READY' && whole.action.type === 'CREATE_TASK') {
      return { multi: false, readyCount: 1, steps: [{ id: 0, text: input.trim(), status: whole.status, action: whole.action, nlp: whole.nlp }] };
    }
  }

  // "বাজারে ৩০০ আর রিকশায় ৪০ টাকা খরচ": "টাকা খরচ" is said once for both sums. A piece
  // with a bare number next to a recorded entry borrows that entry's direction.
  const entry = steps.find((s) => s.status === 'READY' && s.action.type === 'RECORD_EXPENSE');
  if (entry && entry.action.type === 'RECORD_EXPENSE') {
    const suffix = entry.action.kind === 'INCOME' ? ' টাকা আয়' : ' টাকা খরচ';
    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i]!;
      if (s.status !== 'UNSUPPORTED' || !/[০-৯\d]/u.test(s.text)) continue;
      const retry = orchestrate(s.text + suffix, now, context);
      if (retry.status === 'READY' && retry.action.type === 'RECORD_EXPENSE') {
        steps[i] = { ...s, status: retry.status, action: retry.action, nlp: retry.nlp };
      }
    }
  }

  const readyCount = steps.filter((s) => s.status === 'READY').length;
  return { multi: readyCount >= 2, steps, readyCount };
}
