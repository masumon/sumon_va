import type { SQLiteDatabase } from 'expo-sqlite';
import { polishAnswerDetailed } from './nlg';
import { onDeviceLlmEngine } from './on-device-llm-engine';
import { saveConnectionTest, type InstalledModel } from '../model/model-manager';

// The value the model must carry through untouched. Made-up and meaningless on purpose, so
// a pass can only mean the model read the answer and kept it — never that it knew it.
const PROBE_VALUE = 'TEST-4821';

/**
 * Run the Assistant's real answer-writing path (`polishAnswerDetailed`) on the installed
 * model and record the result. A pass needs the model's own words, accepted by the same
 * guards the Assistant uses, with the exact value intact — a silent fall back to the
 * built-in wording is a fail. The first load is slow on a phone, hence the long timeout.
 */
export async function runAssistantConnectionTest(
  db: SQLiteDatabase,
  language: 'bn' | 'en',
): Promise<NonNullable<InstalledModel['connectionTest']>> {
  const bn = language === 'bn';
  const outcome = await polishAnswerDetailed(
    {
      draft: bn ? `আপনার পরীক্ষার কোড ${PROBE_VALUE}।` : `Your test code is ${PROBE_VALUE}.`,
      question: bn ? 'আমার পরীক্ষার কোড কী?' : 'What is my test code?',
      mustContain: PROBE_VALUE,
      language,
      timeoutMs: 45000,
    },
    { engine: onDeviceLlmEngine },
  ).catch(() => null);

  const result = {
    ok: Boolean(outcome?.usedLlm),
    at: new Date().toISOString(),
    ms: outcome?.ms ?? 0,
    sample: outcome?.usedLlm ? outcome.text : undefined,
    fallback: outcome?.usedLlm ? undefined : (outcome?.fallback ?? 'error'),
  };
  await saveConnectionTest(db, result);
  return result;
}
