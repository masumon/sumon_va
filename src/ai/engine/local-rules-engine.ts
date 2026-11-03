import type { AiEngine, AiEngineDescriptor } from './types';

// The always-available engine: the deterministic, on-device NLP + orchestrator that
// the rest of the app already uses (parseLocalNlp / orchestrate). No model, no
// download, no network — and it is the fallback whenever an opt-in engine is absent.
export const localRulesDescriptor: AiEngineDescriptor = {
  id: 'local-rules',
  label: { bn: 'অন্তর্নির্মিত (নিয়মভিত্তিক)', en: 'Built-in (rule-based)' },
  description: {
    bn: 'কোনো মডেল ডাউনলোড ছাড়াই এই ফোনে চলে। টাস্ক ও মেমোরি বোঝার জন্য যথেষ্ট — দ্রুত, হালকা, সম্পূর্ণ অফলাইন।',
    en: 'Runs on this device with no model download. Fast, light, fully offline, and enough to understand tasks and memories.',
  },
  builtIn: true,
};

export const localRulesEngine: AiEngine = {
  descriptor: localRulesDescriptor,
  async isReady() {
    return true;
  },
};
