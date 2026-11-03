import { resolveActiveEngine } from './registry';
import { reportLlmIssue } from '../model/llm-health';
import { scaledTimeout } from '../model/device-profile';
import { recordTiming } from '../../services/assistant-perf';
import type { AiEngine, AiEngineId } from './types';

// Optional natural-language polish for a *already-decided* answer.
//
// The fact and the number always come from deterministic retrieval. If — and only if —
// an on-device LLM is installed and ready, we let it rephrase the sentence to sound
// more natural. Everything about that is guarded:
//   • hard timeout, then fall back to the deterministic text
//   • the model's output must still contain the exact answer value (`mustContain`)
//   • it must be short, single-paragraph, and free of links / markup
// Any violation → we keep the deterministic text. The model can only ever make the
// wording nicer, never change the answer.

export interface PolishRequest {
  /** The deterministic answer sentence to rephrase. Returned unchanged on any failure. */
  draft: string;
  /** The user's question, for phrasing context. */
  question: string;
  /** The exact substring the rewrite must preserve (the answer value). */
  mustContain: string;
  language: 'bn' | 'en';
  preferredEngineId?: AiEngineId | null;
  timeoutMs?: number;
}

/** Why the model's wording was not used — shown to the user, so they can see the AI's state. */
export type PolishFallback = 'not-ready' | 'timeout' | 'rejected' | 'error';

export interface PolishOutcome {
  text: string;
  /** True only when the model's own words were accepted and returned. */
  usedLlm: boolean;
  ms: number;
  fallback?: PolishFallback;
}

const MAX_OUT = 240;

function acceptable(text: string, mustContain: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_OUT) return false;
  if (/\n\s*\n/.test(t)) return false; // multi-paragraph
  if (/https?:\/\/|www\.|[|*`#<>]/.test(t)) return false; // links / markup
  if (mustContain && !t.includes(mustContain)) return false;
  return true;
}

/**
 * The polish, with its outcome reported. `engine` pins a specific engine and skips the
 * readiness gate — used only by the model screen's connection test, which has to run the
 * Assistant's exact writing path *before* the model is allowed to count as ready.
 */
export async function polishAnswerDetailed(req: PolishRequest, opts: { engine?: AiEngine } = {}): Promise<PolishOutcome> {
  const started = Date.now();
  const done = (text: string, usedLlm: boolean, fallback?: PolishFallback): PolishOutcome => {
    const ms = Date.now() - started;
    if (fallback !== 'not-ready') recordTiming('llm-polish', ms, usedLlm);
    return { text, usedLlm, ms, fallback };
  };

  const engine = opts.engine ?? await resolveActiveEngine(req.preferredEngineId ?? null).catch(() => null);
  if (!engine?.generate) return done(req.draft, false, 'not-ready');
  if (!opts.engine && !(await engine.isReady().catch(() => false))) return done(req.draft, false, 'not-ready');

  const langName = req.language === 'bn' ? 'Bengali' : 'English';
  const prompt =
    `Rewrite the ANSWER as one short, natural ${langName} sentence that directly replies to the QUESTION. ` +
    `Keep it factual. Do NOT add any information. Keep the exact value "${req.mustContain}". No lists, no links.\n\n` +
    `QUESTION: ${req.question}\nANSWER: ${req.draft}\n\nREWRITE:`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), scaledTimeout(req.timeoutMs ?? 6000));
  try {
    const out = await engine.generate(prompt, { maxTokens: 96, temperature: 0.2, signal: controller.signal });
    const firstLine = out.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    return acceptable(firstLine, req.mustContain) ? done(firstLine, true) : done(req.draft, false, 'rejected');
  } catch {
        // A time-out is told to the person, in plain words (llm-health.ts).
        if (controller.signal.aborted) reportLlmIssue('TIMEOUT');
        return done(req.draft, false, controller.signal.aborted ? 'timeout' : 'error');
  } finally {
    clearTimeout(timer);
  }
}

export async function polishAnswer(req: PolishRequest): Promise<string> {
  return (await polishAnswerDetailed(req)).text;
}
