import type { SQLiteDatabase } from 'expo-sqlite';
import type { AiEngine, AiEngineId } from './types';
import { localRulesEngine } from './local-rules-engine';

const PREF_KEY = 'aiEngineId';

/** The engine the user picked in Settings → AI engine, or null if never chosen. */
export async function getPreferredEngineId(db: SQLiteDatabase): Promise<AiEngineId | null> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_preferences WHERE key = ?', PREF_KEY,
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setPreferredEngineId(db: SQLiteDatabase, id: AiEngineId): Promise<void> {
  await db.runAsync(
    'INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    PREF_KEY, id,
  );
}

// A tiny in-memory registry. The built-in engine is always present. An opt-in
// advanced engine adds itself with `registerAiEngine()` from its own module — the
// core never references that module by name, so a default build is never affected.

const engines: AiEngine[] = [localRulesEngine];

export function registerAiEngine(engine: AiEngine): void {
  const existing = engines.findIndex((e) => e.descriptor.id === engine.descriptor.id);
  if (existing >= 0) engines[existing] = engine;
  else engines.push(engine);
}

export function listAiEngines(): readonly AiEngine[] {
  return engines;
}

export function getAiEngine(id: AiEngineId): AiEngine | undefined {
  return engines.find((e) => e.descriptor.id === id);
}

/**
 * The engine to use for free-form generation, honoring the user's opt-in choice and
 * falling back to the built-in engine whenever the chosen one is missing or not ready.
 */
export async function resolveActiveEngine(preferredId: AiEngineId | null): Promise<AiEngine> {
  if (preferredId && preferredId !== localRulesEngine.descriptor.id) {
    const chosen = getAiEngine(preferredId);
    try {
      if (chosen && (await chosen.isReady())) return chosen;
    } catch {
      // fall through to the built-in engine
    }
  }
  return localRulesEngine;
}
