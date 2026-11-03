// The opt-in "advanced" engine. It is always registered so the UI can show it, but
// `isReady()` is true only when BOTH a verified model file is installed AND this build
// carries a native GGUF runtime. Until then `resolveActiveEngine()` keeps using the
// built-in rule engine, so nothing breaks.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { AiEngine } from './types';
import { registerAiEngine } from './registry';
import { loadInstalledModel } from '../model/model-manager';
import { generateWith, lastLoadDidNotFinish, probeRuntime } from '../model/llama-runtime';

let dbRef: SQLiteDatabase | null = null;

// isReady() runs on every turn; cache the (filesystem + runtime) check briefly so a
// burst of assistant calls does not re-stat the model file each time.
let readyCache: { value: boolean; at: number } | null = null;
const READY_TTL_MS = 5000;

/** Called once at startup so the engine can reach the model record. */
export function bindOnDeviceLlmEngine(db: SQLiteDatabase): void {
  dbRef = db;
  readyCache = null;
}

const engine: AiEngine = {
  descriptor: {
    id: 'on-device-llm',
    label: { bn: 'উন্নত (ফোনের ভেতরের AI)', en: 'Advanced (AI model on the phone)' },
    description: {
      bn: 'আপনার যোগ করা মডেল ফোনেই চালায় — আপন-এর উত্তর আরও স্বাভাবিক ভাষায় লেখে, ইন্টারনেট ছাড়া। তথ্য ও হিসাব সবসময় অ্যাপের নিজের রেকর্ড থেকেই আসে।',
      en: 'Runs the model you added, on the phone — writes Apon’s answers in more natural language, offline. Facts and figures always come from the app’s own records.',
    },
    builtIn: false,
  },
  async isReady() {
    if (readyCache && Date.now() - readyCache.at < READY_TTL_MS) return readyCache.value;
    let value = false;
    // A previous load took the app down with it: stay on the built-in engine until the
    // model is verified again, rather than crash the same way on the next question.
    if (dbRef && probeRuntime().available && !lastLoadDidNotFinish()) {
      const model = await loadInstalledModel(dbRef);
      // Loading is not enough — the Assistant connection test must also have passed.
      value = Boolean(model?.verifiedAt && model.connectionTest?.ok);
    }
    readyCache = { value, at: Date.now() };
    return value;
  },
  async generate(prompt, options) {
    if (!dbRef) throw new Error('engine not bound');
    const model = await loadInstalledModel(dbRef);
    if (!model) throw new Error('no model installed');
    // Every call goes out as a chat in the model's own template; the Alpaca layout is only
    // the fallback inside the runtime for a file with no template.
    return generateWith(model.path, model.summary.contextLength, prompt, {
      maxTokens: options?.maxTokens ?? 256,
      temperature: options?.temperature ?? 0.3,
      chat: { system: options?.system ?? 'You are a helpful assistant inside a personal organiser app. Follow the instruction exactly.' },
      jsonSchema: options?.jsonSchema,
      signal: options?.signal,
    });
  },
};

registerAiEngine(engine);

export { engine as onDeviceLlmEngine };
