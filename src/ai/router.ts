import type { OrchestratorResult } from './orchestrator';

// One Assistant, one decision about which intelligence handles a turn. Not "AI available →
// always AI": the deterministic core is tried first on every turn, and the model is only
// worth its RAM and seconds where the core genuinely cannot help.
//
//   READY + HIGH    → deterministic. The core understood and can act; the model may still
//                     polish or explain the *result* (nlg / analysis-nlg), never the decision.
//   READY + MEDIUM  → confirm. The core has a reading but is not sure of it, so nothing runs
//                     on its own — not even a read-only question — until the person presses send.
//   READY + LOW     → treated like UNSUPPORTED: a reading this weak is a guess.
//   NEEDS_INPUT     → clarify. A fact is missing (which task, how much, who) — only the person
//                     knows it; a model would have to guess, and guessing is the one thing the
//                     Assistant must not do with someone's records.
//   UNSUPPORTED     → the model tries to understand, when one is ready; otherwise clarify.
export type Route = 'deterministic' | 'confirm' | 'clarify' | 'llm-understand';
export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export const HIGH_CONFIDENCE = 0.85;
export const MEDIUM_CONFIDENCE = 0.6;

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= HIGH_CONFIDENCE) return 'HIGH';
  if (confidence >= MEDIUM_CONFIDENCE) return 'MEDIUM';
  return 'LOW';
}

type RoutedResult = Pick<OrchestratorResult, 'status'> & { nlp?: { confidence: number } };

export function routeTurn(result: RoutedResult, aiReady: boolean): Route {
  // A result without a score (older callers, hand-built actions) is the core's own reading.
  const tier = confidenceTier(result.nlp?.confidence ?? 1);
  if (result.status === 'NEEDS_INPUT') return 'clarify';
  if (result.status === 'READY' && tier === 'HIGH') return 'deterministic';
  if (result.status === 'READY' && tier === 'MEDIUM') return 'confirm';
  return aiReady ? 'llm-understand' : 'clarify';
}
