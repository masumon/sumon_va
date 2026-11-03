// How long each part of an Assistant turn actually takes on this phone. Kept in memory
// only (the last few dozen per stage) — enough to read on the diagnostics screen and to
// tell "the rules answer instantly, the model takes 9 s" from a guess. Nothing is written
// to disk and nothing identifying the question is kept, only the stage and its time.

export type PerfStage =
  | 'plan'            // rule-based understanding of the sentence
  | 'execute'         // running the action against the database, verification included
  | 'llm-load'        // loading the model file into memory
  | 'llm-polish'      // model rewording an answer
  | 'llm-understand'  // model restating a sentence the rules could not read
  | 'llm-analysis'    // model explaining a spending analysis
  | 'llm-general';    // model answering a general question the records could not

export interface PerfSample { stage: PerfStage; ms: number; ok: boolean; at: number }
export interface PerfSummary { stage: PerfStage; count: number; okCount: number; medianMs: number; p95Ms: number; lastMs: number }

const KEEP = 40;
const samples = new Map<PerfStage, PerfSample[]>();

export function recordTiming(stage: PerfStage, ms: number, ok = true): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const list = samples.get(stage) ?? [];
  list.push({ stage, ms: Math.round(ms), ok, at: Date.now() });
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
  samples.set(stage, list);
}

/** Times `work`, records it under `stage` (failed if it throws), and returns its result. */
export async function timed<T>(stage: PerfStage, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const value = await work();
    recordTiming(stage, Date.now() - started, true);
    return value;
  } catch (e) {
    recordTiming(stage, Date.now() - started, false);
    throw e;
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

export function perfSummary(): PerfSummary[] {
  return [...samples.entries()].filter(([, list]) => list.length).map(([stage, list]) => {
    const sorted = list.map((s) => s.ms).sort((a, b) => a - b);
    return {
      stage, count: list.length, okCount: list.filter((s) => s.ok).length,
      medianMs: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), lastMs: list[list.length - 1]?.ms ?? 0,
    };
  });
}

export function clearTimings(): void { samples.clear(); }

/** The synchronous twin of `timed` — for the rule-based reading, which never awaits. */
export function measure<T>(stage: PerfStage, work: () => T): T {
  const started = Date.now();
  const value = work();
  recordTiming(stage, Date.now() - started);
  return value;
}
