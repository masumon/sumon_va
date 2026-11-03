import { resolveActiveEngine } from './registry';
import { reportLlmIssue } from '../model/llm-health';
import { scaledTimeout } from '../model/device-profile';
import type { AiEngine, AiEngineId } from './types';
import { recordTiming } from '../../services/assistant-perf';
import { formatBangladeshWeekdayDate, timeZoneLabel } from '../../i18n/date-time';

// The last resort for a question the app's own records cannot answer — "বাংলাদেশের রাজধানী
// কী?", "প্রেসার বেশি হলে কী খাওয়া ভালো?". The on-device model answers from what it knows,
// and the reply says so plainly: this is general knowledge, not something this person
// saved, and it can be wrong.
//
// Never used for a question about the person's own life ("আমার পাসপোর্ট নম্বর কত?"): the
// model cannot know that, and an invented passport number is worse than "not saved".

const PERSONAL = /(?<![\p{L}\p{M}])(?:আমার|আমাকে|আমি|আমাদের|আমরা|মোর|আমায়)(?![\p{L}\p{M}])|\b(?:my|me|mine|i|we|our)\b/iu;

export function isPersonalQuestion(question: string): boolean {
  return PERSONAL.test(question);
}

export type GeneralAnswer =
  | { ok: true; text: string; ms: number }
  | { ok: false; reason: 'personal' | 'not-ready' | 'timeout' | 'empty' | 'error'; ms: number };

export async function answerFromGeneralKnowledge(question: string, opts: {
  language: 'bn' | 'en';
  preferredEngineId?: AiEngineId | null;
  timeoutMs?: number;
  engine?: AiEngine;
}): Promise<GeneralAnswer> {
  const started = Date.now();
  const fail = (reason: Extract<GeneralAnswer, { ok: false }>['reason']): GeneralAnswer => {
    const ms = Date.now() - started;
    if (reason !== 'not-ready' && reason !== 'personal') recordTiming('llm-general', ms, false);
    return { ok: false, reason, ms };
  };
  if (isPersonalQuestion(question)) return fail('personal');

  const engine = opts.engine ?? await resolveActiveEngine(opts.preferredEngineId ?? null).catch(() => null);
  if (!engine?.generate || !(await engine.isReady().catch(() => false))) return fail('not-ready');

  const lang = opts.language === 'bn' ? 'Bengali (বাংলা)' : 'English';
  const prompt =
    `Answer the question in ${lang}, in one or two short sentences. ` +
    'Be factual and careful. For health, money or legal questions, give general guidance and suggest asking an expert. ' +
    'If you do not know, say you are not sure. Do not invent names, numbers or dates.\n\n' +
    `QUESTION: ${question}\nANSWER:`;

  const controller = new AbortController();
  // Measured on the user's phone: ~6 s to load the model, and Bengali costs many more
  // tokens per word than English — 25 s with 180 tokens ran out before the answer did.
  const timer = setTimeout(() => controller.abort(), scaledTimeout(opts.timeoutMs ?? 60_000));
  try {
    const raw = await engine.generate(prompt, {
      maxTokens: 160, temperature: 0.2, signal: controller.signal,
      // Warm, plain and dated: "today" in a question means the app's own today (time zone setting).
      system: `You are Apon, a friendly helper on a Bangladeshi family's phone. Answer general-knowledge questions correctly and naturally in ${lang}, like a kind neighbour would — one or two short, plain sentences, no jargon. Today is ${formatBangladeshWeekdayDate(new Date(), opts.language)} (${timeZoneLabel(opts.language)}). If unsure, say so honestly.`,
    });
    const text = raw.replace(/^\s*(?:ANSWER|উত্তর)\s*[:：]\s*/iu, '').trim();
    if (!text || text.length < 2) return fail('empty');
    const ms = Date.now() - started;
    recordTiming('llm-general', ms, true);
    return { ok: true, text: text.slice(0, 600), ms };
  } catch {
        // A time-out is told to the person, in plain words (llm-health.ts).
        if (controller.signal.aborted) reportLlmIssue('TIMEOUT');
        return fail(controller.signal.aborted ? 'timeout' : 'error');
  } finally {
    clearTimeout(timer);
  }
}
