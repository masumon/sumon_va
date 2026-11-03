import { resolveActiveEngine } from './registry';
import { reportLlmIssue } from '../model/llm-health';
import { scaledTimeout } from '../model/device-profile';
import { recordTiming } from '../../services/assistant-perf';
import type { AiEngineId } from './types';
import type { PolishFallback } from './nlg';

// The AI explains a fact sheet the app already worked out — it never supplies a fact. Any
// number in its text that is not on the sheet (a small count like "২টি উপায়" aside) sinks
// the whole reply, and the deterministic summary is shown instead.

function numbersIn(text: string): string[] {
  const ascii = text.replace(/[০-৯]/gu, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  return (ascii.match(/\d+(?:[.,]\d+)*/gu) ?? []).map((s) => s.replace(/,/gu, ''));
}

const HARMLESS_COUNTS = new Set(['1', '2', '3', '4', '5', '10']);
const MAX_OUT = 900;

export function staysWithinFacts(reply: string, facts: string): boolean {
  const t = reply.trim();
  if (!t || t.length > MAX_OUT) return false;
  if (/https?:\/\/|www\.|[|*`#<>]/u.test(t)) return false;
  const allowed = new Set([...numbersIn(facts), ...HARMLESS_COUNTS]);
  return numbersIn(t).every((n) => allowed.has(n));
}

export interface ExplainOutcome { text: string; usedLlm: boolean; ms: number; fallback?: PolishFallback }

export async function explainWithFacts(req: {
  facts: string;
  question: string;
  language: 'bn' | 'en';
  preferredEngineId?: AiEngineId | null;
  timeoutMs?: number;
}): Promise<ExplainOutcome> {
  const started = Date.now();
  const done = (text: string, usedLlm: boolean, fallback?: PolishFallback): ExplainOutcome => {
    const ms = Date.now() - started;
    if (fallback !== 'not-ready') recordTiming('llm-analysis', ms, usedLlm);
    return { text, usedLlm, ms, fallback };
  };

  const engine = await resolveActiveEngine(req.preferredEngineId ?? null).catch(() => null);
  if (!engine?.generate || !(await engine.isReady().catch(() => false))) return done(req.facts, false, 'not-ready');

  const lang = req.language === 'bn' ? 'Bengali' : 'English';
  const prompt =
    `You are a careful personal-finance helper. The user asked: "${req.question}".\n` +
    `Their real figures:\n${req.facts}\n\n` +
    `In ${lang}, in at most 4 short sentences: explain where most of the money goes, and suggest 2 practical ways to spend less. ` +
    `Use ONLY the figures above — never write a number that is not listed.\n\nANSWER:`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), scaledTimeout(req.timeoutMs ?? 25000));
  try {
    const out = (await engine.generate(prompt, { maxTokens: 200, temperature: 0.3, signal: controller.signal })).trim();
    return staysWithinFacts(out, req.facts) ? done(out, true) : done(req.facts, false, 'rejected');
  } catch {
        // A time-out is told to the person, in plain words (llm-health.ts).
        if (controller.signal.aborted) reportLlmIssue('TIMEOUT');
        return done(req.facts, false, controller.signal.aborted ? 'timeout' : 'error');
  } finally {
    clearTimeout(timer);
  }
}
