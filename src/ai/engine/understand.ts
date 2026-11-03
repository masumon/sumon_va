import { resolveActiveEngine } from './registry';
import { reportLlmIssue } from '../model/llm-health';
import { scaledTimeout } from '../model/device-profile';
import type { AiEngine, AiEngineId } from './types';
import { planTurn, type TurnPlan } from '../planner/planner';
import type { OrchestrationContext } from '../context';
import { recordTiming } from '../../services/assistant-perf';

// When the rule-based core says "I don't understand", the model gets one job: restate the
// sentence as the command(s) the core *does* understand — as JSON, one entry per thing the
// person asked for, in the order they should happen. A long request ("মাসের বিল দিলাম
// ৩০০০ টাকা, আর কাল রহিমকে ফোন করার কথা মনে করিয়ে দিও") comes back as two commands
// that run as one plan. It never decides or acts — the restated text goes back through
// the same planner, and the person still sees it and presses send / confirm before
// anything happens (design: tracker §১১-B).
//
// Guards, each a hard reject:
//   • a number in the restatement that the person never said
//   • a person or category name that is not in what they said
//   • a restatement the core still cannot fully read

const EXAMPLES = [
  'বাজারে ৫০০ টাকা খরচ',
  'বেতন পেলাম ২৫০০০ টাকা',
  'কাল সকাল ৮টায় ওষুধ কিনতে মনে করিয়ে দিও',
  'রহিমকে ২০০০ টাকা ধার দিলাম',
  'বাসার ওয়াইফাই পাসওয়ার্ড কী?',
  'গত ৩ মাসের খরচ বিশ্লেষণ করো',
  'আজকের কাজগুলো দেখাও',
  'দুধ কেনার কাজটা শেষ হয়েছে',
];

function digitsOf(text: string): string[] {
  const ascii = text.replace(/[০-৯]/gu, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  return (ascii.match(/\d+/gu) ?? []);
}

function inventsNumbers(output: string, input: string): boolean {
  const said = new Set(digitsOf(input));
  return digitsOf(output).some((n) => !said.has(n));
}

/** Names the model may not make up: the person on a debt, the category on an entry. */
function inventsNames(plan: TurnPlan, input: string): boolean {
  const said = input.toLocaleLowerCase();
  return plan.steps.some(({ action }) =>
    (action.type === 'CREATE_DEBT' && !said.includes(action.personName.toLocaleLowerCase()))
    || (action.type === 'RECORD_EXPENSE' && action.category != null && !said.includes(action.category.toLocaleLowerCase())));
}

// Strips a list bullet ("- ", "1. ") and wrapping quotes — never a number the command starts with.
const clean = (line: string) => line.trim()
  .replace(/^(?:[-*•]|\d+[.)])\s+/u, '')
  .replace(/^["“”'`]+|["“”'`]+$/gu, '')
  .trim();

/**
 * The commands out of the model's reply. JSON is what was asked for; a small model that
 * ignores that and writes a bare line is still read, as a single command. "NONE" / an empty
 * list means the model could not tell either.
 */
export function readCommands(raw: string): string[] {
  const json = raw.match(/\{[\s\S]*\}/u)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { commands?: unknown };
      if (Array.isArray(parsed.commands)) {
        return parsed.commands.filter((c): c is string => typeof c === 'string').map(clean).filter(Boolean).slice(0, 4);
      }
    } catch { /* fall through to the plain-line reading */ }
  }
  const line = clean(raw.split('\n').find((l) => l.trim()) ?? '');
  return !line || /^none\b/iu.test(line) || line.startsWith('{') ? [] : [line];
}

export type UnderstandOutcome =
  | { ok: true; text: string; commands: string[]; plan: TurnPlan; ms: number }
  | { ok: false; reason: 'not-ready' | 'timeout' | 'no-match' | 'invented' | 'error'; ms: number };

export async function understandWithLlm(input: string, opts: {
  language: 'bn' | 'en';
  preferredEngineId?: AiEngineId | null;
  context?: OrchestrationContext;
  now?: Date;
  timeoutMs?: number;
  engine?: AiEngine;
}): Promise<UnderstandOutcome> {
  const started = Date.now();
  const fail = (reason: Extract<UnderstandOutcome, { ok: false }>['reason']): UnderstandOutcome => {
    const ms = Date.now() - started;
    if (reason !== 'not-ready') recordTiming('llm-understand', ms, false);
    return { ok: false, reason, ms };
  };

  const engine = opts.engine ?? await resolveActiveEngine(opts.preferredEngineId ?? null).catch(() => null);
  if (!engine?.generate || !(await engine.isReady().catch(() => false))) return fail('not-ready');

  const prompt =
    'Rewrite the user\'s message as the short command(s) this app understands, in the user\'s language. ' +
    `Commands it understands look like:\n${EXAMPLES.map((e) => `- ${e}`).join('\n')}\n` +
    'If the message asks for several things, write one command per thing, in order (at most 4). ' +
    'Keep every number, name and date exactly as the user said them. Add nothing. ' +
    'Answer with JSON only, like {"commands":["..."]}. If you cannot tell what they want, answer {"commands":[]}.\n\n' +
    `USER: ${input}\nJSON:`;

  const controller = new AbortController();
  // Bengali takes many tokens and the model may need loading first (~6 s on the phone).
  const timer = setTimeout(() => controller.abort(), scaledTimeout(opts.timeoutMs ?? 45_000));
  try {
    const raw = await engine.generate(prompt, {
      maxTokens: 200, temperature: 0, signal: controller.signal,
      system: 'You turn a person\'s message into short commands for a personal organiser app. You never answer the message and never add facts.',
      // Grammar-enforced: the model can only produce {"commands": [...]}.
      jsonSchema: { type: 'object', properties: { commands: { type: 'array', items: { type: 'string' }, maxItems: 4 } }, required: ['commands'] },
    });
    const commands = readCommands(raw);
    if (!commands.length || commands.some((c) => c.length > 160) || (commands.length === 1 && commands[0] === input.trim())) return fail('no-match');
    if (commands.some((c) => inventsNumbers(c, input))) return fail('invented');
    // One text the planner splits back into the same steps — so the person sees, edits and
    // confirms exactly what will run, through the ordinary plan card.
    const text = commands.join(opts.language === 'bn' ? ', তারপর ' : ', then ');
    const plan = planTurn(text, opts.now ?? new Date(), opts.context ?? {});
    if (!plan.steps.length || plan.steps.some((s) => s.status !== 'READY' || s.action.type === 'CLARIFY')) return fail('no-match');
    if (inventsNames(plan, input)) return fail('invented');
    const ms = Date.now() - started;
    recordTiming('llm-understand', ms, true);
    return { ok: true, text, commands, plan, ms };
  } catch {
        // A time-out is told to the person, in plain words (llm-health.ts).
        if (controller.signal.aborted) reportLlmIssue('TIMEOUT');
        return fail(controller.signal.aborted ? 'timeout' : 'error');
  } finally {
    clearTimeout(timer);
  }
}
