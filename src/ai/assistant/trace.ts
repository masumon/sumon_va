// Lightweight, in-memory assistant telemetry — no network, no persistence.
//
// Every assistant turn appends one record: the raw input, the resolved intent, the
// action, timing, and the outcome. It powers on-device monitoring ("why did it answer
// that?") and cheap evaluation in tests. The buffer is bounded so it can never grow
// without limit.

export interface AssistantTurnTrace {
  at: string;
  input: string;
  source: 'text' | 'voice';
  intent: string;
  confidence: number;
  status: string;
  actionType: string;
  outcome: string;
  durationMs: number;
  /** Optional step log from a sub-pipeline (e.g. question answering). */
  detail?: string[];
}

const MAX_TURNS = 50;
const buffer: AssistantTurnTrace[] = [];
const listeners = new Set<(trace: AssistantTurnTrace) => void>();

export function recordAssistantTurn(trace: AssistantTurnTrace): void {
  buffer.push(trace);
  if (buffer.length > MAX_TURNS) buffer.splice(0, buffer.length - MAX_TURNS);
  if ((globalThis as { __DEV__?: boolean }).__DEV__ && !process.env.JEST_WORKER_ID) {
    console.log(
      `[assistant] ${trace.intent}/${trace.status} → ${trace.outcome} (${trace.durationMs}ms)`,
      trace.detail ?? '',
    );
  }
  for (const listener of listeners) {
    try { listener(trace); } catch { /* a bad listener must not break a turn */ }
  }
}

export function getAssistantTrace(): readonly AssistantTurnTrace[] {
  return buffer;
}

export function clearAssistantTrace(): void {
  buffer.length = 0;
}

export function onAssistantTurn(listener: (trace: AssistantTurnTrace) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
